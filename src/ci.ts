// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

export interface BuildInfo {
  readonly domain: string
  readonly headSha: string
  readonly id: string
  readonly owner: string
  readonly repo: string
}

export interface JobInfo {
  readonly jobId: string
  readonly finishedAt: string
  readonly ignoreFailure: boolean
  readonly name: string
  readonly startedAt: string
  readonly state: string
  readonly url: string
}

export interface StatusInfo {
  readonly repository: {
    readonly name: string
    readonly owner: { readonly login: string }
  }
  readonly sha: string
  readonly target_url?: string
}

export type GetJobOutputFunc = (jobInfo: JobInfo) => Promise<object | undefined>
