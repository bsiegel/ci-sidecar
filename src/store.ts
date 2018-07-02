import { BuildInfo, JobInfo } from './ci'

const data = new Map<string, JobInfo[]>()

export class Store {
  private readonly build: BuildInfo

  public constructor (build: BuildInfo) {
    this.build = build
  }

  public updateAllJobs (jobs: JobInfo[]): JobInfo[] {
    const oldJobs = data.get(this.build.id)
    data.set(this.build.id, jobs)
    return (oldJobs || [])
  }

  public updateJob (jobInfo: JobInfo): void {
    const jobs = data.get(this.build.id)
    if (!jobs) {
      return
    }

    const jobIndex = jobs.findIndex(j => j.jobId === jobInfo.jobId)
    if (jobIndex > -1) {
      jobs[jobIndex] = jobInfo
    } else {
      jobs.push(jobInfo)
    }

    data.set(this.build.id, jobs)
  }

  public remove (): void {
    data.delete(this.build.id)
  }
}
