// tslint:disable-next-line:no-implicit-dependencies
import Octokit from '@octokit/rest'
import { Context, Logger } from 'probot'

import { BuildInfo, GetJobOutputFunc, JobDiff, JobInfo } from './ci'

// https://developer.github.com/v3/checks/runs/#response
interface GithubChecksCreateResponse {
  readonly id: number
}

// https://developer.github.com/v3/checks/runs/#response-3
interface GithubChecksListResponse {
  readonly check_runs: ReadonlyArray<GithubCheck>
}

interface GithubCheck {
  readonly external_id?: string
  readonly id: number
  readonly name: string
  readonly status: 'completed' | 'in_progress' | 'queued'
  readonly app: { readonly id: number }
}

export class GitHub {
  private static readonly FINISHED_STATES = ['passed', 'failed', 'errored', 'canceled']

  private readonly appId: number
  private readonly buildInfo: BuildInfo
  private readonly client: Octokit
  private readonly getJobOutput: GetJobOutputFunc
  private readonly log: Logger

  public constructor (
    appId: number,
    context: Context,
    buildInfo: BuildInfo,
    getJobOutput: GetJobOutputFunc
  ) {
    this.appId = appId
    this.buildInfo = buildInfo
    this.client = context.github
    this.getJobOutput = getJobOutput
    this.log = context.log
  }

  public async jobsToUpdate (newJobs: ReadonlyArray<JobInfo>): Promise<JobDiff> {
    const create: JobInfo[] = []
    const update: JobInfo[] = []

    const existingChecks = await this.getExistingChecks()
    for (const current of newJobs) {
      const existing = existingChecks.find(c => this.isCheckForJob(c, current))
      if (!existing) {
        create.push(current)
      } else if (this.getStatus(current) !== existing.status || current.name !== existing.name) {
        current.checkRunId = existing.id.toString()
        update.push(current)
      }
    }

    return {
      create,
      update
    }
  }

  public async createCheck (jobInfo: JobInfo): Promise<string | undefined> {
    const payload = this.getChecksCreateParams(jobInfo)
    if (payload.status === 'completed') {
      await this.addCompletionInfo(payload, jobInfo)
    }

    this.log.debug(`Creating check for job ${jobInfo.jobId}`, payload)
    try {
      const result = await this.client.checks.create(payload)
      const checkRunId = (result.data as GithubChecksCreateResponse).id.toString()
      this.log.debug(`Check ${checkRunId} created for job ${jobInfo.jobId}`)
      return checkRunId
    } catch (e) {
      this.log.error(e, `Error occurred creating check for job ${jobInfo.jobId}`)
      return undefined
    }
  }

  public async updateCheck (jobInfo: JobInfo): Promise<void> {
    const payload = this.getChecksUpdateParams(jobInfo)
    if (payload.status === 'completed') {
      await this.addCompletionInfo(payload, jobInfo)
    }

    this.log.debug(`Updating check ${jobInfo.checkRunId} for job ${jobInfo.jobId}`, payload)
    try {
      await this.client.checks.update(payload)
      this.log.debug(`Check ${jobInfo.checkRunId} updated for job ${jobInfo.jobId}`)
    } catch (e) {
      this.log.error(
        e,
        `Error occurred updating check ${jobInfo.checkRunId} for job ${jobInfo.jobId}`
      )
    }
  }

  private async getExistingChecks (): Promise<ReadonlyArray<GithubCheck>> {
    this.log.debug(`Fetching existing checks for build ${this.buildInfo.id}`)
    try {
      const result = await this.client.checks.listForRef({
        owner: this.buildInfo.owner,
        ref: this.buildInfo.headSha,
        repo: this.buildInfo.repo
      })

      const checksResponse = result.data as GithubChecksListResponse
      const myChecks = checksResponse.check_runs.filter(c => c.app.id === this.appId)
      this.log.debug(`Fetched ${myChecks.length} existing checks for build ${this.buildInfo.id}`)
      return myChecks
    } catch (e) {
      this.log.error(e, `Error occurred fetching existing checks for build ${this.buildInfo.id}`)
      return []
    }
  }

  private isCheckForJob (c: GithubCheck, j: JobInfo): boolean {
    if (!c.external_id) {
      return false
    }
    const [buildId, jobId] = c.external_id.split('/')
    return this.buildInfo.id === buildId && j.jobId === jobId
  }

  private getChecksCreateParams (jobInfo: JobInfo): Octokit.ChecksCreateParams {
    return {
      details_url: jobInfo.url,
      external_id: `${this.buildInfo.id}/${jobInfo.jobId}`,
      head_branch: this.buildInfo.headBranch,
      head_sha: this.buildInfo.headSha,
      name: jobInfo.name,
      owner: this.buildInfo.owner,
      repo: this.buildInfo.repo,
      started_at: jobInfo.startedAt,
      status: this.getStatus(jobInfo)
    }
  }

  private getChecksUpdateParams (jobInfo: JobInfo): Octokit.ChecksUpdateParams {
    return {
      check_run_id: jobInfo.checkRunId!,
      details_url: jobInfo.url,
      external_id: `${this.buildInfo.id}/${jobInfo.jobId}`,
      name: jobInfo.name,
      owner: this.buildInfo.owner,
      repo: this.buildInfo.repo,
      started_at: jobInfo.startedAt,
      status: this.getStatus(jobInfo)
    }
  }

  private async addCompletionInfo (
    payload: Octokit.ChecksCreateParams | Octokit.ChecksUpdateParams,
    jobInfo: JobInfo
  ): Promise<void> {
    payload.conclusion = this.getConclusion(jobInfo)
    payload.completed_at = jobInfo.finishedAt

    try {
      const output = await this.getJobOutput(jobInfo)
      if (output) {
        payload.output = output as
          | Octokit.ChecksCreateParamsOutput
          | Octokit.ChecksUpdateParamsOutput
      }
    } catch (e) {
      this.log.error(
        e,
        `Error occurred while getting job output for job ${jobInfo.jobId}, output will be skipped`
      )
    }
  }

  private getStatus (jobInfo: JobInfo) {
    if (GitHub.FINISHED_STATES.includes(jobInfo.state)) {
      return 'completed'
    } else if (jobInfo.state === 'started') {
      return 'in_progress'
    } else {
      return 'queued'
    }
  }

  private getConclusion (jobInfo: JobInfo) {
    if (jobInfo.state === 'passed') {
      return 'success'
    } else if (jobInfo.state === 'failed' && !jobInfo.ignoreFailure) {
      return 'failure'
    } else if (jobInfo.state === 'canceled') {
      return 'cancelled'
    } else {
      return 'neutral'
    }
  }
}
