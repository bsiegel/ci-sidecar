declare module 'probot-metadata' {
  import { Context } from 'probot'
  import Octokit from '@octokit/rest'

  declare namespace probotMetadata {
    interface ProbotMetadata {
      (context: Context, issue?: Issue): Metadata
    }
    
    interface Metadata {
      get(key?: string): Promise<object | undefined>
      set(value: object): Promise<Octokit.AnyResponse>
      set(key: string, value: object): Promise<Octokit.AnyResponse>
    }

    interface Issue {
      body?: string
      number: number
      owner: string
      repo: string
    }
  }

  declare const probotMetadata: probotMetadata.ProbotMetadata
  export default probotMetadata
}