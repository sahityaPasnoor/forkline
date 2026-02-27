const repository = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? '';
const isUserOrOrgSite = repository.endsWith('.github.io');
const base = process.env.DOCS_BASE || (repository ? (isUserOrOrgSite ? '/' : `/${repository}/`) : '/');

export default {
  title: 'Forkline',
  description: 'Local-first orchestration platform for running coding agents in isolated Git worktrees.',
  lang: 'en-US',
  appearance: 'dark',
  base,
  cleanUrls: true,
  lastUpdated: true,
  metaChunk: true,
  head: [
    ['meta', { name: 'theme-color', content: '#090d14' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'icon', href: '/logo.svg' }]
  ],
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'New System Setup', link: '/guide/new-system-setup' },
      { text: 'Getting Started', link: '/guide/getting-started' },
      { text: 'How To Use', link: '/guide/how-to-use' },
      { text: 'Project Dossier', link: '/guide/project-dossier' },
      { text: 'Architecture', link: '/architecture/overview' },
      { text: 'Core API', link: '/reference/core-api' }
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'New System Setup', link: '/guide/new-system-setup' },
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'How To Use', link: '/guide/how-to-use' },
            { text: 'Project Dossier', link: '/guide/project-dossier' }
          ]
        }
      ],
      '/architecture/': [
        {
          text: 'Architecture',
          items: [
            { text: 'Overview', link: '/architecture/overview' }
          ]
        }
      ],
      '/reference/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Core API', link: '/reference/core-api' }
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
};
