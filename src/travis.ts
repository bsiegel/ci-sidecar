// tslint:disable-next-line:no-implicit-dependencies
import { Status } from 'github-webhook-event-types'
import { Context } from 'probot'
// tslint:disable-next-line:no-submodule-imports
import { LoggerWithTarget } from 'probot/lib/wrap-logger'
import { createInterface as createReadline } from 'readline'
import * as request from 'request'
import * as requestAsync from 'request-promise-native'

import { BuildInfo, JobInfo } from './ci'

const DEFAULT_HEADERS: request.Headers = { 'Travis-API-Version': 3 }

// https://developer.travis-ci.com/resource/build
export interface TravisBuild {
  jobs: TravisJob[]
  pull_request_number: number
}

// https://developer.travis-ci.com/resource/jobs
export interface TravisJob {
  allow_failure: boolean
  id: number
  state: string
  started_at: string
  finished_at: string
  config: { env: string }
}

export class Travis {
  public static tryCreate (context: Context): Travis | null {
    try {
      return new Travis(context)
    } catch (e) {
      return null
    }
  }

  private readonly baseUri: string
  private readonly buildId: string
  private readonly headBranch: string
  private readonly headers: request.Headers
  private readonly headSha: string
  private readonly jobUri: string
  private readonly log: LoggerWithTarget
  private readonly owner: string
  private readonly repo: string
  private buildInfo?: TravisBuild

  public constructor (context: Context) {
    const {
      target_url: targetUrl,
      sha: headSha,
      branches: [{ name: headBranch }],
      repository: { name: repoName, owner: { login: repoOwner } }
    } = (context.payload as any as Status)

    this.log = context.log
    this.owner = repoOwner
    this.repo = repoName
    this.headSha = headSha
    this.headBranch = headBranch
    this.buildId = (/\/builds\/(\d+)/g.exec(targetUrl) || [])[1]

    const domain = (/\/\/(travis-ci\.\w+)\//g.exec(targetUrl) || [])[1]
    this.baseUri = `https://api.${domain}`
    this.jobUri = `https://${domain}/${this.owner}/${this.repo}/jobs`

    this.headers = {
      ...DEFAULT_HEADERS,
      ...(domain === 'travis-ci.com' && process.env.TRAVIS_TOKEN) ? { 'Authorization': `token ${process.env.TRAVIS_TOKEN}` } : null
    }
  }

  public async loadBuildInfo (): Promise<BuildInfo> {
    const buildUri = `${this.baseUri}/build/${this.buildId}?include=build.jobs,job.config`
    this.buildInfo = await requestAsync({
      headers: this.headers,
      json: true,
      uri: buildUri
    }).promise() as TravisBuild

    return this.getBuildInfo()
  }

  public getSupportedJobs (): JobInfo[] {
    return this.buildInfo!.jobs.map(this.getJobInfo, this)
                               .filter(present)
  }

  public getBuildInfo (): BuildInfo {
    return {
      headBranch: this.headBranch,
      headSha: this.headSha,
      id: this.buildId,
      number: this.buildInfo!.pull_request_number,
      owner: this.owner,
      repo: this.repo
    }
  }

  public async getJobOutput (jobInfo: JobInfo): Promise<object | null> {
    return new Promise<object | null>((resolve, reject) => {
      const jobId = jobInfo.jobId
      const logUri = `${this.baseUri}/job/${jobId}/log.txt`
      let outputString = ''
      let capture = false

      this.log.debug(`Getting log stream for job ${jobId}`)
      const req = request({
        headers: this.headers,
        uri: logUri
      }).on('error', e => reject(e))

      const lines = createReadline(req as any as NodeJS.ReadableStream)
      lines.on('line', (line: string) => {
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
      }).on('close', () => {
        this.log.debug(`Parsing output of job ${jobId}`)
        resolve(tryParse(outputString))
      })
    })
  }

  private getJobInfo (job: TravisJob): JobInfo | null {
    const jobName = this.extractName(job.config.env)
    if (!jobName) {
      return null
    }

    this.log.debug(`Detected Job '${jobName}' in state '${job.state}'`)
    return {
      finishedAt: job.finished_at,
      ignoreFailure: job.allow_failure,
      jobId: job.id.toString(),
      name: jobName,
      startedAt: (job.started_at || new Date().toISOString()),
      state: job.state,
      url: `${this.jobUri}/${job.id}`
    }
  }

  private extractName (env: string): string | null {
    const match = /CHECK_NAME=('.*?'|".*?"|\S+)/g.exec(env)
    if (match) {
      return match[1].replace(/["']/g, '')
    } else {
      return null
    }
  }
}

function tryParse (str: string): object | null {
  try {
    return JSON.parse(str)
  } catch (e) {
    return null
  }
}

function present<T> (input: null | undefined | T): input is T {
  return input != null
}
