// tslint:disable-next-line:no-implicit-dependencies
import * as Octokit from '@octokit/rest'
import { Context } from 'probot'
// tslint:disable-next-line:no-submodule-imports
import { LoggerWithTarget } from 'probot/lib/wrap-logger'

import { BuildInfo, GetJobOutputFunc, JobDiff, JobInfo } from './ci'

interface GithubChecksCreateResponse {
  id: number
}

export class GitHub {
  private static readonly FINISHED_STATES = [
    'passed',
    'failed',
    'errored',
    'canceled'
  ]

  private readonly buildInfo: BuildInfo
  private readonly client: Octokit
  private readonly getJobOutput: GetJobOutputFunc
  private readonly log: LoggerWithTarget

  public constructor (context: Context, buildInfo: BuildInfo, getJobOutput: GetJobOutputFunc) {
    this.buildInfo = buildInfo
    this.client = context.github
    this.log = context.log
    this.getJobOutput = getJobOutput
  }
  public jobsToUpdate (oldJobs: JobInfo[], newJobs: JobInfo[]): JobDiff {
    const diff: JobDiff = {
      create: [],
      update: []
    }

    for (const current of newJobs) {
      const previous = oldJobs.find(j => j.jobId === current.jobId)
      if (!previous) {
        diff.create.push(current)
      } else if (this.getStatus(current) !== this.getStatus(previous) || current.name !== previous.name) {
        diff.update.push(current)
      }
    }

    return diff
  }

  public async createCheck (jobInfo: JobInfo): Promise<string> {
    const payload = this.getChecksCreateParams(jobInfo)
    if (payload.status === 'completed') {
      await this.addCompletionInfo(payload, jobInfo)
    }

    this.log.debug(`Creating check for job ${jobInfo.jobId}`, payload)
    const result = await this.client.checks.create(payload)
    const checkRunId = (result.data as GithubChecksCreateResponse).id.toString()
    this.log.debug(`Check ${checkRunId} created for job ${jobInfo.jobId}`)
    return checkRunId
  }

  public async updateCheck (jobInfo: JobInfo): Promise<void> {
    const payload = this.getChecksUpdateParams(jobInfo)
    if (payload.status === 'completed') {
      await this.addCompletionInfo(payload, jobInfo)
    }

    this.log.debug(`Updating check ${jobInfo.checkRunId} for job ${jobInfo.jobId}`, payload)
    await this.client.checks.update(payload)
    this.log.debug(`Check ${jobInfo.checkRunId} updated for job ${jobInfo.jobId}`)
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

  private async addCompletionInfo (payload: Octokit.ChecksCreateParams | Octokit.ChecksUpdateParams, jobInfo: JobInfo): Promise<void> {
    payload.conclusion = this.getConclusion(jobInfo)
    payload.completed_at = jobInfo.finishedAt

    const output = await this.getJobOutput(jobInfo)
    if (output) {
      payload.output = output as Octokit.ChecksCreateParamsOutput | Octokit.ChecksUpdateParamsOutput
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
