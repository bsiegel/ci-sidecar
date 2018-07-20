// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

import { Status } from 'github-webhook-event-types'
import { Context, Logger } from 'probot'
import { createInterface as createReadline } from 'readline'
import request from 'request'
import requestAsync from 'request-promise-native'

import { BuildInfo, JobInfo } from './ci'

const DEFAULT_HEADERS: request.Headers = { 'Travis-API-Version': 3 }

// https://developer.travis-ci.com/resource/build
interface TravisBuild {
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
      const buildInfo = (await requestAsync({
        headers: this.headers,
        json: true,
        uri: buildUri
      }).promise()) as TravisBuild
      return buildInfo.jobs.map(this.getJobInfo, this).filter(present)
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
            await delay(3000)
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
      let trimmed = ''
      let started = false
      let finished = false
      let closed = false

      this.log.debug(`Getting log stream for job ${jobId}`)
      const req = request({
        headers: this.headers,
        uri: logUri
      }).on('error', e => reject(e))

      const lines = createReadline((req as any) as NodeJS.ReadableStream)
      lines
        .on('line', (line: string) => {
          if (closed || finished) {
            return
          }

          trimmed = line.trim()
          if (!started && trimmed === '---output') {
            this.log.debug(`Fenced output block detected for job ${jobId}`)
            started = true
          } else if (started && trimmed === '---') {
            this.log.debug(`Detected end of fenced output block for job ${jobId}`)
            finished = true
            try {
              req.abort()
            } catch (e) {
              // ignore
            } finally {
              lines.close()
            }
          } else if (started) {
            outputString += trimmed
          }
        })
        .on('close', () => {
          closed = true
          if (finished) {
            this.log.debug(`Finished reading output block for ${jobId}, parsing...`)
            try {
              resolve(JSON.parse(outputString))
            } catch (e) {
              this.log.error(`Failed to parse JSON object: ${e.toString()}`)
              this.log.debug(outputString)
              reject(e)
            }
          } else if (trimmed.includes('Your build exited')) {
            this.log.debug(`Finished getting log stream for job ${jobId}, no output block detected`)
            resolve(undefined)
          } else {
            this.log.debug(`Log stream for job ${jobId} was incomplete`)
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

async function delay (ms: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}
