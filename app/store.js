const data = new Map()

module.exports = class Store {
  /**
   * @param {string} buildId
   * @param {Object.<number, JobInfo>} jobs
   */
  updateJobs (buildId, jobs) {
    const oldJobs = data.get(buildId)
    data.set(buildId, jobs)
    return (oldJobs || {})
  }

  /**
   * @param {string} buildId
   * @param {number} jobId
   * @param {number} checkRunId
   */
  setCheckRunId (buildId, jobId, checkRunId) {
    const jobs = data.get(buildId)
    if (jobs[jobId]) {
      jobs[jobId].checkRunId = checkRunId
      data.set(buildId, jobs)
    }
  }

  /**
   * @param {string} buildId
   */
  delete (buildId) {
    data.delete(buildId)
  }
}
