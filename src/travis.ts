// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

// tslint:disable-next-line:no-implicit-dependencies
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
        branches: [{ name: headBranch }],
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
        headBranch,
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
    this.headers = {
      ...DEFAULT_HEADERS,
      ...(buildInfo.domain === 'travis-ci.com' && process.env.TRAVIS_TOKEN
        ? { Authorization: `token ${process.env.TRAVIS_TOKEN}` }
        : undefined)
    }
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
    return new Promise<object | undefined>((resolve, reject) => {
      const jobId = jobInfo.jobId
      const logUri = `${this.baseUri}/job/${jobId}/log.txt`
      let outputString = ''
      let capture = false

      this.log.debug(`Getting log stream for job ${jobId}`)
      const req = request({
        headers: this.headers,
        uri: logUri
      }).on('error', e => reject(e))

      const lines = createReadline((req as any) as NodeJS.ReadableStream)
      lines
        .on('line', (line: string) => {
          const trimmed = line.trim()
          if (!capture && trimmed === '---output') {
            this.log.debug(`Fenced output block detected for job ${jobId}`)
            capture = true
          } else if (capture && trimmed === '---') {
            try {
              lines.close()
              req.abort()
            } catch (e) {
              // ignore
            } finally {
              this.log.debug(`Parsing output of job ${jobId}`)
              resolve(tryParse(outputString))
            }
          } else if (capture) {
            outputString += trimmed
          }
        })
        .on('close', () => {
          this.log.debug(`Parsing output of job ${jobId}`)
          resolve(tryParse(outputString))
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

function tryParse (str: string): object | undefined {
  try {
    return JSON.parse(str)
  } catch (e) {
    return undefined
  }
}

function present<T> (input: null | undefined | T): input is T {
  return input != undefined
}
