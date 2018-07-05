export interface BuildInfo {
  readonly headBranch: string
  readonly headSha: string
  readonly id: string
  readonly owner: string
  readonly number: number
  readonly repo: string
}

export interface JobDiff {
  readonly create: ReadonlyArray<JobInfo>
  readonly update: ReadonlyArray<JobInfo>
}

export interface JobInfo {
  readonly jobId: string
  checkRunId?: string
  readonly finishedAt: string
  readonly ignoreFailure: boolean
  readonly name: string
  readonly startedAt: string
  readonly state: string
  readonly url: string
}

export type GetJobOutputFunc = (jobInfo: JobInfo) => Promise<object | undefined>
