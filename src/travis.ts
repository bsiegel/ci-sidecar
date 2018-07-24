// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

import { Status } from 'github-webhook-event-types'
import { Context, Logger } from 'probot'
import { Headers } from 'request'
import request from 'request-promise-native'
import { promisify } from 'util'

import { BuildInfo, JobInfo } from './ci'

const setTimeoutAsync = promisify(setTimeout)

const DEFAULT_HEADERS: Headers = { 'Travis-API-Version': 3 }

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
  private readonly headers: Headers
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
      const travisInfo = (await request({
        gzip: true,
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
    const jobId = jobInfo.jobId
    const logUri = `${this.baseUri}/job/${jobId}/log.txt`
    let outputString = ''
    let lineCount = 0
    let blockStarted = false

    this.log.debug(`Getting log stream for job ${jobId}`)
    const logData = (await request({
      gzip: true,
      headers: this.headers,
      uri: logUri
    }).promise()) as string

    for (const line of splitIter(logData, /\r?\n/g)) {
      lineCount += 1
      const trimmed = line.trim()
      if (!blockStarted && trimmed === '---output') {
        this.log.debug(`Fenced output block detected for job ${jobId} at line ${lineCount}`)
        blockStarted = true
      } else if (blockStarted && trimmed === '---') {
        this.log.debug(`Detected end of fenced output block for job ${jobId} at line ${lineCount}`)
        try {
          return JSON.parse(outputString)
        } catch (e) {
          this.log.error(e, `Failed to parse JSON object`)
          this.log.debug(outputString)
          throw e
        }
      } else if (blockStarted) {
        outputString += trimmed
      } else if (trimmed.includes('Your build exited')) {
        this.log.debug(
          `Finished getting log stream for job ${jobId}, no output block detected in ${lineCount} lines`
        )
        return undefined
      }
    }

    this.log.debug(`Log stream for job ${jobId} was incomplete`)
    throw new Error('LogStreamIncomplete')
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

function* splitIter (input: string, regex: RegExp): IterableIterator<string> {
  let last = 0
  while (true) {
    const result = regex.exec(input)
    if (!result) {
      if (last <= input.length) {
        yield input.substr(last, input.length - last)
      }
      return
    }

    yield input.substr(last, result.index - last)
    last = regex.lastIndex
  }
}
