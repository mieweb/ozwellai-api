import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: 'doc',
      id: 'overview',
      label: '📚 Overview',
    },
    {
      type: 'category',
      label: '📱 Frontend Integration',
      collapsed: false,
      items: [
        'frontend/overview',
        {
          type: 'category',
          label: 'Quick Embed',
          items: [
            'frontend/cdn-embed',
          ],
        },
        {
          type: 'category',
          label: 'Framework Guides',
          items: [
            'frontend/react',
            'frontend/nextjs',
            'frontend/vue3',
            'frontend/vue2',
            'frontend/svelte',
            'frontend/vanilla',
          ],
        },
        {
          type: 'category',
          label: 'Advanced',
          items: [
            'frontend/iframe-integration',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: '⚙️ Backend Integration',
      collapsed: false,
      items: [
        'backend/overview',
        {
          type: 'category',
          label: 'SDK Guides',
          items: [
            'backend/sdk-typescript',
            'backend/sdk-deno',
            'backend/sdk-python',
            'backend/rest-api',
          ],
        },
        {
          type: 'category',
          label: 'API Reference',
          items: [
            'backend/api-overview',
            'backend/api-endpoints',
            'backend/api-authentication',
            'backend/api-examples',
          ],
        },
      ],
    },
    {
      type: 'doc',
      id: 'CONTRIBUTING',
      label: '🤝 Contributing',
    },
  ],
};

export default sidebars;
