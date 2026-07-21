/// <reference types="vite/client" />

// Vite raw imports (e.g. `import html from './x.html?raw'`) return the file's
// contents as a string.
declare module '*?raw' {
  const content: string
  export default content
}
