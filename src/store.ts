import { Context, Logger } from 'probot'
import metadata from 'probot-metadata'

import { BuildInfo, JobInfo } from './ci'

interface Memory {
  [key: string]: JobInfo[] | undefined
}

export class Store {
  private readonly build: BuildInfo
  private readonly data: metadata.Metadata
  private readonly log: Logger

  public constructor (context: Context, build: BuildInfo) {
    this.build = build
    this.data = metadata(context, {
      number: build.number,
      owner: build.owner,
      repo: build.repo
    })
    this.log = context.log
  }

  public async replace (jobs: ReadonlyArray<JobInfo>): Promise<ReadonlyArray<JobInfo>> {
    const memory = (await this.data.get()) as Memory | undefined
    const oldJobs = memory ? memory[this.build.id] : undefined
    if (oldJobs) {
      this.log.debug(`Store updating existing memory for build ${this.build.id}`)
    } else {
      this.log.debug(`Store creating new memory for build ${this.build.id}`)
    }

    await this.data.set({ [this.build.id]: jobs })
    return oldJobs || []
  }

  public async update (jobsToUpdate: ReadonlyArray<JobInfo>): Promise<void> {
    const jobs = (await this.data.get(this.build.id)) as JobInfo[] | undefined
    if (!jobs) {
      this.log.debug(`Store cannot update job, no memory of build ${this.build.id}`)
      return
    }

    for (const jobInfo of jobsToUpdate) {
      const jobIndex = jobs.findIndex(j => j.jobId === jobInfo.jobId)
      if (jobIndex > -1) {
        this.log.debug(`Store updating existing job ${jobInfo.jobId} for build ${this.build.id}`)
        jobs[jobIndex] = jobInfo
      } else {
        this.log.debug(`Store adding new job ${jobInfo.jobId} for build ${this.build.id}`)
        jobs.push(jobInfo)
      }
    }

    await this.data.set(this.build.id, jobs)
  }
}
