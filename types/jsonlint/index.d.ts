declare module 'jsonlint' {
  declare namespace jsonLint {
    interface JSONLint {
      parse(text: string): any
    }
  }

  declare const jsonLint: jsonLint.JSONLint
  export default jsonLint
}