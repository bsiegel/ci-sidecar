const request = require('request-promise-native')
const stream = require('request')
const readline = require('readline')

module.exports = class Travis {
  /**
   * @typedef {object} Status
   * @property {string} target_url
   * @property {string} sha
   * @property {Array<{name: string}>} branches
   * @property {{name: string, owner: {login: string}}} repository
   *
   * @param {Status} payload
   */
  constructor (payload) {
    this.initialized = false

    try {
      const {
        target_url: targetUrl,
        sha: headSha,
        branches: [{name: headBranch}],
        repository: {name: repoName, owner: {login: repoOwner}}
      } = payload

      this.owner = repoOwner
      this.repo = repoName
      this.headSha = headSha
      this.headBranch = headBranch
      this.buildId = /\/builds\/(\d+)/g.exec(targetUrl)[1]

      const domain = /\/\/(travis-ci\.\w+)\//g.exec(targetUrl)[1]
      this.baseUri = `https://api.${domain}`
      this.jobUri = `https://${domain}/${this.owner}/${this.repo}/jobs`
      this.headers = {'Travis-API-Version': 3}
      if (domain === 'travis-ci.com' && process.env.TRAVIS_TOKEN) {
        this.headers['Authorization'] = `token ${process.env.TRAVIS_TOKEN}`
      }
      this.initialized = true
    } catch (e) { }
  }

  /**
   * @typedef {object} TravisJob
   * @property {number} id
   * @property {string} state
   * @property {string} started_at
   * @property {string} finished_at
   * @property {boolean} allow_failure
   * @property {{env: string}} config
   */
  async getSupportedJobs () {
    const buildUri = `${this.baseUri}/build/${this.buildId}?include=build.jobs,job.config`

    /** @type {{jobs: Array<TravisJob>}} */
    const buildJson = await request({
      json: true,
      uri: buildUri,
      headers: this.headers
    })

    return buildJson.jobs.map(this.getJobInfo, this)
                         .filter(j => j)
                         .reduce((out, j) => Object.assign(out, j), {})
  }

  /**
   * @typedef {object} JobInfo
   * @property {string} name
   * @property {string} state
   * @property {string} startedAt
   * @property {string} finishedAt
   * @property {boolean} ignoreFailure
   * @property {string} url

   * @param {TravisJob} job
   * @returns {Object.<number, JobInfo>}
   */
  getJobInfo (job) {
    const jobName = this.extractName(job.config.env)
    if (jobName) {
      console.log(`Detected Job '${jobName}' in state '${job.state}'`)
      return {
        [job.id]: {
          name: jobName,
          state: job.state,
          startedAt: (job.started_at || new Date().toISOString()),
          finishedAt: job.finished_at,
          ignoreFailure: job.allow_failure,
          url: `${this.jobUri}/${job.id}`
        }
      }
    }
  }

  extractName (env) {
    const match = /CHECK_NAME=('.*?'|".*?"|\S+)/g.exec(env)
    if (match) {
      return match[1].replace(/["']/g, '')
    }
  }

  tryParse (str) {
    try {
      return JSON.parse(str)
    } catch (e) {
      return null
    }
  }

  /**
   * @param {number} jobId
   */
  async getJobOutput (jobId) {
    return new Promise((resolve, reject) => {
      const logUri = `${this.baseUri}/job/${jobId}/log.txt`
      let outputString = ''
      let capture = false

      console.log(`Getting log stream for job ${jobId}`)
      const req = stream({
        uri: logUri,
        headers: this.headers
      }).on('error', e => reject(e))

      const lines = readline.createInterface(req)
      lines.on('line', line => {
        const trimmed = line.trim()
        if (!capture && trimmed === '---output') {
          console.log(`Fenced output block detected for job ${jobId}`)
          capture = true
        } else if (capture && trimmed === '---') {
          try {
            lines.close()
            req.abort()
          } catch (e) {
            // ignore
          } finally {
            resolve(this.tryParse(outputString))
          }
        } else if (capture) {
          outputString += trimmed
        }
      }).on('close', () => resolve(this.tryParse(outputString)))
    })
  }
}
