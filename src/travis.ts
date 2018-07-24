// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

import { Status } from 'github-webhook-event-types'
import { Context, Logger } from 'probot'
import request from 'request'
import requestAsync from 'request-promise-native'
import split2 from 'split2'
import { promisify } from 'util'

import { BuildInfo, JobInfo } from './ci'

const setTimeoutAsync = promisify(setTimeout)

const DEFAULT_HEADERS: request.Headers = { 'Travis-API-Version': 3 }

// https://developer.travis-ci.com/resource/build
interface TravisBuild {
  readonly event_type: string
  readonly jobs: ReadonlyArray<TravisJob>
}

// https://developer.travis-ci.com/resource/jobs
interface TravisJob {
  readonly allow_failure: boolean
  readonly config: { readonly env: string }
  readonly finished_at: string
  readonly id: number
  readonly started_at: string
  readonly state: string
}

type ParserState =
  | 'initial'
  | 'inside-block'
  | 'block-complete'
  | 'stream-finished'
  | 'error'
  | 'closed'

export class Travis {
  public static parseStatus (payload: Status): BuildInfo | undefined {
    try {
      const {
        repository: {
          name: repoName,
          owner: { login: repoOwner }
        },
        sha: headSha,
        target_url: targetUrl
      } = payload

      const buildId = (/\/builds\/(\d+)/g.exec(targetUrl) || [])[1]
      const domain = (/\/\/(travis-ci\.\w+)\//g.exec(targetUrl) || [])[1]
      if (!buildId || !domain) {
        return undefined
      }

      return {
        domain: domain.toLowerCase(),
        headSha,
        id: buildId,
        owner: repoOwner,
        repo: repoName
      }
    } catch (e) {
      return undefined
    }
  }

  private readonly baseUri: string
  private readonly buildInfo: BuildInfo
  private readonly headers: request.Headers
  private readonly jobUri: string
  private readonly log: Logger

  public constructor (context: Context, buildInfo: BuildInfo) {
    this.baseUri = `https://api.${buildInfo.domain}`
    this.buildInfo = buildInfo
    this.headers = DEFAULT_HEADERS
    this.jobUri = `https://${buildInfo.domain}/${buildInfo.owner}/${buildInfo.repo}/jobs`
    this.log = context.log
  }

  public async getSupportedJobs (): Promise<ReadonlyArray<JobInfo> | undefined> {
    const buildUri = `${this.baseUri}/build/${this.buildInfo.id}?include=build.jobs,job.config`

    try {
      const travisInfo = (await requestAsync({
        headers: this.headers,
        json: true,
        uri: buildUri
      }).promise()) as TravisBuild

      if (travisInfo.event_type === 'pull_request') {
        return travisInfo.jobs.map(this.getJobInfo, this).filter(present)
      } else {
        this.log.info(`Build for event '${travisInfo.event_type}' will not be processed`)
        return undefined
      }
    } catch (e) {
      this.log.error(e, `Failed to load job info for build ${this.buildInfo.id}`)
      return undefined
    }
  }

  public async getJobOutput (jobInfo: JobInfo): Promise<object | undefined> {
    let tries = 10
    while (tries > 0) {
      try {
        return await this.getJobOutputImpl(jobInfo)
      } catch (e) {
        if (e.message === 'LogStreamIncomplete') {
          tries -= 1
          if (tries > 0) {
            this.log.debug(`Retrying incomplete operation in 3s (${tries} tries left)`)
            await setTimeoutAsync(3_000)
          }
        } else {
          throw e
        }
      }
    }

    throw new Error(`Log stream for job ${jobInfo.jobId} never completed`)
  }

  private async getJobOutputImpl (jobInfo: JobInfo): Promise<object | undefined> {
    return new Promise<object | undefined>((resolve, reject) => {
      const jobId = jobInfo.jobId
      const logUri = `${this.baseUri}/job/${jobId}/log.txt`
      let outputString = ''
      let lineCount = 0
      let state: ParserState = 'initial'

      this.log.debug(`Getting log stream for job ${jobId}`)
      const req = request({
        headers: this.headers,
        uri: logUri
      })

      const deadline = setTimeout(() => {
        if (inProgress(state)) {
          // the response stream was never completed
          state = 'error'
          this.log.error(`Deadline elapsed while getting log stream for job ${jobId}`)
          req.abort()
          reject(new Error('LogStreamIncomplete'))
        }
      }, 30_000)

      req
        .pipe(split2())
        .on('data', (line: string) => {
          lineCount += 1

          if (!inProgress(state)) {
            // only consider lines while looking for an output block
            return
          }

          const trimmed = line.trim()
          if (state === 'initial' && trimmed === '---output') {
            state = 'inside-block'
            this.log.debug(`Fenced output block detected for job ${jobId} at line ${lineCount}`)
          } else if (state === 'inside-block' && trimmed === '---') {
            state = 'block-complete'
            this.log.debug(
              `Detected end of fenced output block for job ${jobId} at line ${lineCount}`
            )
            clearTimeout(deadline)
            req.abort()
            try {
              resolve(JSON.parse(outputString))
            } catch (e) {
              this.log.error(e, `Failed to parse JSON object`)
              this.log.debug(outputString)
              reject(e)
            }
          } else if (state === 'inside-block') {
            outputString += trimmed
          } else if (trimmed.includes('Your build exited')) {
            state = 'stream-finished'
            this.log.debug(
              `Finished getting log stream for job ${jobId}, no output block detected in ${lineCount} lines`
            )
            clearTimeout(deadline)
            req.abort()
            resolve(undefined)
          }
        })
        .on('error', e => {
          if (inProgress(state)) {
            // only care about an error while looking for an output block
            state = 'error'
            this.log.error(e, `Error occurred getting log stream for job ${jobId}`)
            clearTimeout(deadline)
            req.abort()
            reject(e)
          }
        })
        .on('close', () => {
          if (inProgress(state)) {
            // only care about a close if we never found an output block or the end of the stream
            state = 'closed'
            this.log.debug(`Log stream for job ${jobId} was incomplete`)
            clearTimeout(deadline)
            reject(new Error('LogStreamIncomplete'))
          }
        })
        .on('end', () => {
          if (inProgress(state)) {
            // only care about a close if we never found an output block or the end of the stream
            state = 'closed'
            this.log.debug(`Log stream for job ${jobId} was incomplete`)
            clearTimeout(deadline)
            reject(new Error('LogStreamIncomplete'))
          }
        })
    })
  }

  private getJobInfo (job: TravisJob): JobInfo | undefined {
    const jobName = this.extractName(job.config.env)
    if (!jobName) {
      return undefined
    }

    this.log.debug(`Detected Job '${jobName}' in state '${job.state}'`)
    return {
      finishedAt: job.finished_at,
      ignoreFailure: job.allow_failure,
      jobId: job.id.toString(),
      name: jobName,
      startedAt: job.started_at || new Date().toISOString(),
      state: job.state,
      url: `${this.jobUri}/${job.id}`
    }
  }

  private extractName (env: string): string | undefined {
    const match = /CHECK_NAME=('.*?'|".*?"|\S+)/g.exec(env)
    if (match) {
      return match[1].replace(/["']/g, '')
    } else {
      return undefined
    }
  }
}

function present<T> (input: null | undefined | T): input is T {
  return input != undefined
}

function inProgress (state: ParserState): boolean {
  return state === 'initial' || state === 'inside-block'
}
