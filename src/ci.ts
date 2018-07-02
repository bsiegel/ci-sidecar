export interface BuildInfo {
  headBranch: string
  headSha: string
  id: string
  owner: string
  number: number
  repo: string
}

export interface JobDiff {
  create: JobInfo[]
  update: JobInfo[]
}

export interface JobInfo {
  jobId: string
  checkRunId?: string
  finishedAt: string
  ignoreFailure: boolean
  name: string
  startedAt: string
  state: string
  url: string
}

export type GetJobOutputFunc = (jobInfo: JobInfo) => Promise<object | null>
