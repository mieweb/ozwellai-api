import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Ozwell API Documentation',
  tagline: 'Privacy-first AI integration for your applications',
  favicon: 'img/favicon.png',

  // Production URL
  url: 'https://mieweb.github.io',
  baseUrl: '/ozwellai-api/',

  // GitHub pages deployment config
  organizationName: 'mieweb',
  projectName: 'ozwellai-api',

  onBrokenLinks: 'throw',
  onBrokenAnchors: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  // Enable Mermaid diagrams
  markdown: {
    mermaid: true,
  },
  themes: ['@docusaurus/theme-mermaid'],

  presets: [
    [
      'classic',
      {
        docs: {
          path: '.', // Use current directory for docs
          routeBasePath: '/', // Serve docs at root
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/mieweb/ozwellai-api/edit/main/docs/',
          exclude: [
            'node_modules/**',
            'build/**',
            'src/**',
            'static/**',
            '.docusaurus/**',
            'package.json',
            'package-lock.json',
            'tsconfig.json',
            'docusaurus.config.ts',
            'sidebars.ts',
            'SUMMARY.md', // We use sidebars.ts instead
            'assets/**',
          ],
        },
        blog: false, // Disable blog for now
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    // Social card image
    image: 'img/ozwell-social-card.png',

    // Mermaid diagram theming with MIE brand colors
    mermaid: {
      theme: { light: 'base', dark: 'dark' },
      options: {
        themeVariables: {
          // MIE Navy Blue - primary nodes (white text for contrast)
          primaryColor: '#0b1844',
          primaryTextColor: '#ffffff',
          primaryBorderColor: '#091336',
          
          // MIE Green - secondary nodes (white text for contrast)
          secondaryColor: '#04a454',
          secondaryTextColor: '#ffffff',
          secondaryBorderColor: '#038a46',
          
          // MIE Yellow - tertiary/highlights (navy text for contrast)
          tertiaryColor: '#ffd100',
          tertiaryTextColor: '#0b1844',
          tertiaryBorderColor: '#e6bc00',
          
          // General styling - dark text on light backgrounds
          lineColor: '#0b1844',
          textColor: '#1a1a1a',
          
          // Node backgrounds - white for readability
          mainBkg: '#ffffff',
          nodeBorder: '#0b1844',
          nodeTextColor: '#1a1a1a',
          
          // Cluster/subgraph styling
          clusterBkg: '#f8f9fa',
          clusterBorder: '#0b1844',
          
          // Notes
          noteBkgColor: '#ffd100',
          noteTextColor: '#0b1844',
          noteBorderColor: '#e6bc00',
          
          // Labels and edges
          edgeLabelBackground: '#ffffff',
        },
      },
    },
    
    navbar: {
      title: 'Ozwell API',
      logo: {
        alt: 'Ozwell Logo',
        src: 'img/ozwell.png',
        srcDark: 'img/ozwell.png',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {
          href: 'https://github.com/mieweb/ozwellai-api',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },

    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Getting Started',
              to: '/',
            },
            {
              label: 'Frontend Integration',
              to: '/frontend/overview',
            },
            {
              label: 'Backend Integration',
              to: '/backend/overview',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/mieweb/ozwellai-api',
            },
            {
              label: 'GitHub Discussions',
              href: 'https://github.com/mieweb/ozwellai-api/discussions',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'Contributing',
              to: '/CONTRIBUTING',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Medical Informatics Engineering (MIE). Built with Docusaurus.`,
    },

    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'typescript', 'python', 'go', 'rust', 'java', 'csharp', 'php', 'ruby'],
    },

    // Announcement bar for privacy-first messaging
    announcementBar: {
      id: 'privacy_first',
      content: '🔒 <strong>Privacy First:</strong> Ozwell conversations are private by default. <a href="/ozwellai-api/frontend/overview#privacy-by-design">Learn more</a>',
      backgroundColor: '#04a454',
      textColor: '#ffffff',
      isCloseable: true,
    },

    // Algolia search (optional - can configure later)
    // algolia: {
    //   appId: 'YOUR_APP_ID',
    //   apiKey: 'YOUR_SEARCH_API_KEY',
    //   indexName: 'ozwell',
    // },
  } satisfies Preset.ThemeConfig,
};

export default config;
