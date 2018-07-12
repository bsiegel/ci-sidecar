// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

export interface BuildInfo {
  readonly domain: string
  readonly headSha: string
  readonly id: string
  readonly owner: string
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
