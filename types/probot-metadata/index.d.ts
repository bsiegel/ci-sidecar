declare module 'probot-metadata' {
  import { Context } from 'probot'
  import Octokit from '@octokit/rest'

  declare namespace probotMetadata {
    interface ProbotMetadata {
      (context: Context, issue?: Issue): Metadata
    }
    
    interface Metadata {
      get (): Promise<Data | undefined>
      get (key: string): Promise<object | undefined>
      set (value: Data): Promise<Octokit.AnyResponse>
      set (key: string, value: object): Promise<Octokit.AnyResponse>
    }

    interface Data {
      [key: string]: object | undefined
    }

    interface Issue {
      body?: string
      readonly number: number
      readonly owner: string
      readonly repo: string
    }
  }

  declare const probotMetadata: probotMetadata.ProbotMetadata
  export default probotMetadata
}