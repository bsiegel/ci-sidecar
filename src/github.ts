// tslint:disable-next-line:no-implicit-dependencies
import Octokit from '@octokit/rest'
import { Context, Logger } from 'probot'

import { BuildInfo, GetJobOutputFunc, JobDiff, JobInfo } from './ci'

// https://developer.github.com/v3/checks/runs/#response
interface GithubChecksCreateResponse {
  readonly id: number
}

export class GitHub {
  private static readonly FINISHED_STATES = ['passed', 'failed', 'errored', 'canceled']

  private readonly buildInfo: BuildInfo
  private readonly client: Octokit
  private readonly getJobOutput: GetJobOutputFunc
  private readonly log: Logger

  public constructor (context: Context, buildInfo: BuildInfo, getJobOutput: GetJobOutputFunc) {
    this.buildInfo = buildInfo
    this.client = context.github
    this.getJobOutput = getJobOutput
    this.log = context.log
  }

  public jobsToUpdate (oldJobs: ReadonlyArray<JobInfo>, newJobs: ReadonlyArray<JobInfo>): JobDiff {
    const create: JobInfo[] = []
    const update: JobInfo[] = []

    for (const current of newJobs) {
      const previous = oldJobs.find(j => j.jobId === current.jobId)
      if (!previous) {
        create.push(current)
      } else if (
        this.getStatus(current) !== this.getStatus(previous) ||
        current.name !== previous.name
      ) {
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
      this.log.error(e, `Error occurred updating check ${jobInfo.checkRunId} for job ${jobInfo.jobId}`)
    }
  }

  private getChecksCreateParams (jobInfo: JobInfo): Octokit.ChecksCreateParams {
    return {
      details_url: jobInfo.url,
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
        payload.output = output as Octokit.ChecksCreateParamsOutput | Octokit.ChecksUpdateParamsOutput
      }
    } catch (e) {
      this.log.error(e, `Error occurred while getting job output for job ${jobInfo.jobId}, output will be skipped`)
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
