# Assets Directory

This directory contains static assets for the Ozwell documentation:

- **Images** — Screenshots, logos, icons
- **Diagrams** — Architecture diagrams (prefer Mermaid in Markdown when possible)
- **Code Samples** — Standalone example files

## Guidelines

### Images

- Use PNG for screenshots and diagrams
- Use SVG for logos and icons when possible
- Optimize images before committing (compress PNGs)
- Use descriptive filenames: `react-integration-flow.png`

### Naming Convention

```
{topic}-{description}.{ext}

Examples:
- frontend-architecture.png
- api-auth-flow.svg
- chat-widget-dark-theme.png
```

### Referencing Assets

From documentation files:

```markdown
![Description](../assets/image-name.png)
```

### Size Guidelines

- Keep images under 500KB when possible
- Use appropriate resolution (2x for retina, reasonable dimensions)
- Consider dark/light mode variations for UI screenshots
