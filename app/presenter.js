const FINISHED_STATES = [
  'passed',
  'failed',
  'errored',
  'canceled'
]

module.exports = class Presenter {
  /**
   * @param {object} dataSource
   * @param {string} dataSource.headBranch
   * @param {string} dataSource.headSha
   * @param {string} dataSource.owner
   * @param {string} dataSource.repo
   * @param {function(number)} dataSource.getJobOutput
   */
  constructor (dataSource) {
    this.dataSource = dataSource
  }

  /**
   * @param {Object.<number, JobInfo>} oldJobs
   * @param {Object.<number, JobInfo>} newJobs
   */
  async calculateDiff (oldJobs, newJobs) {
    const create = []
    const update = []
    let pending = 0

    for (const [jobId, current] of Object.entries(newJobs)) {
      const currentStatus = this.getStatus(current.state)
      if (currentStatus !== 'completed') {
        pending += 1
      }

      const previous = oldJobs[jobId]
      if (!previous) {
        create.push(this.getPayload(jobId, current, false))
      } else if (currentStatus !== this.getStatus(previous.state) || current.name !== previous.name) {
        update.push(this.getPayload(jobId, current, true))
      }
    }

    return {
      pending: pending,
      create: await Promise.all(create),
      update: await Promise.all(update)
    }
  }

  async getPayload (jobId, jobInfo, forUpdate) {
    const payload = {
      owner: this.dataSource.owner,
      repo: this.dataSource.repo,
      name: jobInfo.name,
      status: this.getStatus(jobInfo.state),
      started_at: jobInfo.startedAt,
      details_url: jobInfo.url
    }

    if (forUpdate) {
      payload.check_run_id = jobInfo.checkRunId
    } else {
      payload.head_branch = this.dataSource.headBranch
      payload.head_sha = this.dataSource.headSha
    }

    if (payload.status === 'completed') {
      payload.conclusion = this.getConclusion(jobInfo)
      payload.completed_at = jobInfo.finishedAt

      const output = await this.dataSource.getJobOutput(jobId)
      if (output) {
        payload.output = output
      }
    }

    return {
      jobId: jobId,
      payload: payload
    }
  }

  getStatus (state) {
    if (FINISHED_STATES.includes(state)) {
      return 'completed'
    } else if (state === 'started') {
      return 'in_progress'
    } else {
      return 'queued'
    }
  }

  getConclusion (jobInfo) {
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
