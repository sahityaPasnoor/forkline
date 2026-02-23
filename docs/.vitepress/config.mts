import { defineConfig } from 'vitepress';

const repository = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? '';
const isUserOrOrgSite = repository.endsWith('.github.io');
const base = process.env.DOCS_BASE || (repository ? (isUserOrOrgSite ? '/' : `/${repository}/`) : '/');

export default defineConfig({
  title: 'Forkline',
  description: 'Local-first orchestration platform for running coding agents in isolated Git worktrees.',
  lang: 'en-US',
  base,
  cleanUrls: true,
  lastUpdated: true,
  metaChunk: true,
  head: [
    ['meta', { name: 'theme-color', content: '#0b1523' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'icon', href: '/logo.svg' }]
  ],
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Architecture', link: '/architecture/overview' },
      { text: 'API', link: '/reference/core-api' },
      { text: 'Operations', link: '/operations/security' },
      { text: 'Contributing', link: '/community/contributing' }
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Developer Workflow', link: '/guide/developer-workflow' },
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'Troubleshooting', link: '/guide/troubleshooting' }
          ]
        }
      ],
      '/architecture/': [
        {
          text: 'Architecture',
          items: [
            { text: 'Overview', link: '/architecture/overview' },
            { text: 'Package Boundaries', link: '/architecture/packages' },
            { text: 'Runtime Flows', link: '/architecture/runtime-flows' }
          ]
        }
      ],
      '/reference/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Core API', link: '/reference/core-api' },
            { text: 'Agent Control API', link: '/reference/agent-control-api' },
            { text: 'Event Model', link: '/reference/events' },
            { text: 'Quick Actions', link: '/reference/quick-actions' },
            { text: 'Environment Variables', link: '/reference/environment-variables' }
          ]
        }
      ],
      '/operations/': [
        {
          text: 'Operations',
          items: [
            { text: 'Security', link: '/operations/security' },
            { text: 'Release Process', link: '/operations/release' },
            { text: 'CI/CD and Quality Gates', link: '/operations/ci-cd' }
          ]
        }
      ],
      '/community/': [
        {
          text: 'Community',
          items: [
            { text: 'Contributing', link: '/community/contributing' },
            { text: 'Open Source Standards', link: '/community/open-source-standards' },
            { text: 'Docs Style Guide', link: '/community/docs-style-guide' }
          ]
        }
      ]
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/sahityaPasnoor/forkline' }],
    editLink: {
      pattern: 'https://github.com/sahityaPasnoor/forkline/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    },
    search: {
      provider: 'local'
    },
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © Forkline contributors'
    },
    outline: {
      level: [2, 3]
    }
  },
  markdown: {
    lineNumbers: true
  }
});
