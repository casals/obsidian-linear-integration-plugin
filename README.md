# Linear Integration for Obsidian

A comprehensive Linear integration plugin for Obsidian that provides seamless bidirectional synchronization between your notes and Linear issues. Create, sync, and manage Linear issues directly from Obsidian with advanced features like autocomplete, conflict resolution, and automatic label creation.

## ✨ Features

### Core Functionality
- **🔄 Bidirectional Sync**: Keep Linear issues and Obsidian notes in perfect sync
- **📝 Issue Creation**: Convert markdown notes to Linear issues with inline tags and auto-fill
- **🏷️ Smart Tag Support**: Use `@assignee/john`, `@status/done`, `@label/bug`, `@priority/1` syntax
- **⚡ Real-time Autocomplete**: Smart suggestions for users, statuses, labels, projects, and teams
- **🎨 Color-coded Labels**: Visual label organization with Linear's actual colors
- **🔍 Quick Edit**: Edit Linear issues without leaving Obsidian
- **💡 Interactive Tooltips**: Hover over issue links to see instant previews with actions

### Advanced Sync Features
- **🗂️ Multi-team Sync**: Sync multiple Linear teams into separate vault folders simultaneously
- **⚔️ Intelligent Conflict Resolution**: Smart detection and resolution of sync conflicts
- **🤖 Auto-fill from Expressions**: Automatically populate issue fields from note content
- **🏷️ Dynamic Label Creation**: Automatically create new labels when they don't exist
- **📊 API Retry Logic**: Robust API handling with exponential backoff
- **⚙️ Granular Settings**: Fine-tune autocomplete, tooltips, and auto-fill behavior

### Productivity Features
- **📋 Kanban Generation**: Auto-generate kanban boards from your Linear issues
- **📅 Agenda Views**: Create agenda notes with due dates and priorities
- **💬 Comment Mirroring**: Sync Linear comments to your notes
- **🚀 Batch Operations**: Bulk create/update issues across multiple notes
- **🎯 Custom Status Mapping**: Map Linear statuses to your preferred emojis

### Enterprise Features
- **🏢 Multi-workspace Support**: Handle multiple Linear organizations
- **🔐 Secure Token Storage**: Encrypted API key management
- **⚙️ Local Configuration**: Per-folder `.linear.json` config files
- **📊 Conflict Analytics**: Track and analyze sync conflicts
- **🎯 Advanced Filtering**: Custom GraphQL queries and filters

## 🚀 Quick Start

### Installation

1. **Download**: Get the latest release from [GitHub Releases](https://github.com/casals/obsidian-linear-integration-plugin/releases)
2. **Install**: Extract to `.obsidian/plugins/linear-integration/` in your vault
3. **Enable**: Go to Settings → Community Plugins → Enable "Linear Integration"

### Setup

1. **Get API Key**: Go to [Linear Settings → API](https://linear.app/settings/api) and create a Personal API Key
2. **Configure Plugin**: 
   - Open Obsidian Settings → Linear Integration
   - Enter your API key (`lin_api_...`)
   - Click "Test Connection" to verify
   - Select your default team
   - Configure auto-fill and autocomplete settings

### Basic Usage

#### Creating Issues from Notes

Add inline tags to any note:
```markdown
# Bug: Login validation not working 

@team/Engineering @assignee/sarah.jones @priority/1 @status/In Progress @label/critical @label/frontend

The login form doesn't validate email addresses properly when users enter malformed addresses.

Steps to reproduce:
1. Navigate to login page
2. Enter invalid email format
3. Submit form

Expected: Validation error shown
Actual: Form submits successfully
```

Then run the "Create Linear Issue from Note" command or use `Ctrl/Cmd + P` → "Linear: Create Issue".

#### Auto-fill from Expressions

Enable "Auto-fill from Note Expressions" in settings to automatically populate issue fields:

- **Team**: `@team/Engineering` → Auto-selects Engineering team
- **Assignee**: `@assignee/john.doe` → Auto-assigns to John Doe  
- **Priority**: `@priority/1` → Sets to Urgent priority
- **Status**: `@status/In Progress` → Sets initial status
- **Labels**: `@label/bug @label/urgent` → Creates and assigns labels

#### Syncing Existing Issues

Use the sync button in the ribbon or run "Sync Linear Issues" command to pull your Linear issues into Obsidian.

## 📖 Documentation

### Enhanced Inline Tag Syntax

| Tag Type | Syntax | Example | Auto-complete |
|----------|--------|---------|---------------|
| Team | `@team/team-name` | `@team/Engineering` | ✅ |
| Assignee | `@assignee/username` | `@assignee/john.doe` | ✅ |
| Status | `@status/status-name` | `@status/In Progress` | ✅ |
| Priority | `@priority/number` | `@priority/1` | ✅ |
| Project | `@project/project-name` | `@project/Q4 Roadmap` | ✅ |
| Labels | `@label/label-name` | `@label/bug @label/urgent` | ✅ |

**Note**: All tags support spaces in names (e.g., `@assignee/John Doe`, `@status/In Review`)

### Auto-complete Features

The plugin provides intelligent autocomplete with:
- **Context-aware suggestions** based on your Linear workspace
- **Color-coded labels** matching Linear's label colors
- **Hierarchical label display** (groups and child labels)
- **Default value prioritization** from local config
- **Fuzzy matching** for faster selection

Type any of the tag prefixes and see instant suggestions:
- `@team/` → Shows all available teams
- `@assignee/` → Shows all team members
- `@status/` → Shows workflow states
- `@label/` → Shows existing labels with colors

### Multi-team Sync

If you work across multiple Linear teams or projects, you can sync each team into its own vault folder simultaneously.

**Setup:**

1. Open Settings → Linear Integration → **Team Sync** section
2. Click **+ Add team** — your teams load automatically from Linear
3. Select a team and set its vault folder (e.g. `Linear Issues/Golden Wealth`)
4. Repeat for each team
5. Each team has an enable/disable toggle so you can pause a project without removing it
6. Run **Sync Linear Issues** — each team's issues appear in their own folder as editable notes

**Example layout:**
```
Linear Issues/
  Golden Wealth/          ← GW team issues
    GW-1 - Insurance Policy Inventory.md
    GW-2 - Power of Attorney Builder.md
    ...
  Engineering/            ← ENG team issues
    ENG-42 - Fix login bug.md
    ...
  Marketing/              ← MKT team issues
    MKT-7 - Q3 campaign brief.md
    ...
```

Each sync does a full pull per team, so all issues stay current regardless of when you last synced. The legacy single-team **Default Team** + **Sync Folder** settings remain as a fallback when no team sync configs are defined.

### Local Configuration

Create `.linear.json` files in any folder to customize behavior:

```json
{
  "workspace": "my-company",
  "team": "engineering", 
  "project": "q4-roadmap",
  "defaultAssignee": "john.doe@company.com",
  "defaultPriority": 3,
  "autoSync": true,
  "labels": [
    "frontend",
    "backend", 
    "bug-fix"
  ],
  "template": "# {{title}}\n\n**Status:** {{status}} | **Priority:** {{priority}}\n**Assignee:** {{assignee}} | **Team:** {{team}}\n\n## Context\n{{description}}\n\n## Acceptance Criteria\n- [ ] \n\n## Notes\n\n\n---\n*Linear: [{{identifier}}]({{url}}) | Last synced: {{lastSync}}*",
  "syncRules": {
    "bidirectional": true,
    "conflictResolution": "manual",
    "includeComments": true
  },
  "display": {
    "showTooltips": true,
    "enableQuickEdit": true,
    "statusIcons": {
      "Backlog": "📋",
      "Todo": "📝", 
      "In Progress": "🔄",
      "In Review": "👀",
      "Done": "✅",
      "Canceled": "❌"
    }
  }
}
```

### Frontmatter Integration

The plugin automatically manages frontmatter for synced notes:

```yaml
---
linear_id: "issue-uuid"
linear_identifier: "ENG-123"
linear_status: "In Progress"
linear_assignee: "John Doe"
linear_team: "Engineering"
linear_url: "https://linear.app/issue/ENG-123"
linear_created: "2024-01-15T10:30:00Z"
linear_updated: "2024-01-16T14:22:00Z"
linear_last_synced: "2024-01-16T14:25:00Z"
linear_priority: 1
linear_estimate: 5
linear_labels: ["bug", "frontend", "critical"]
---
```

### Custom Templates

Customize note generation with template variables:

```markdown
# {{title}}

**Status:** {{status}} | **Priority:** {{priority}}
**Assignee:** {{assignee}} | **Team:** {{team}}
**Created:** {{created}} | **Updated:** {{updated}}

## Description
{{description}}

## Acceptance Criteria
- [ ] 

## Notes


---
*Linear: [{{identifier}}]({{url}}) | Last synced: {{lastSync}}*
```

Available variables:
- `{{title}}`, `{{description}}`, `{{status}}`, `{{assignee}}`
- `{{team}}`, `{{priority}}`, `{{estimate}}`, `{{created}}`
- `{{updated}}`, `{{identifier}}`, `{{url}}`, `{{lastSync}}`

## ⚙️ Configuration

### Plugin Settings

| Setting | Description | Default |
|---------|-------------|---------|
| **API Key** | Your Linear Personal API Key | - |
| **Team Sync Configs** | List of teams to sync, each with its own vault folder | [] |
| **Default Team** | Fallback team for new issues (used when no team sync configs defined) | - |
| **Sync Folder** | Fallback folder for Linear notes (used when no team sync configs defined) | "Linear Issues" |
| **Auto Sync** | Sync on startup | false |
| **Sync Interval** | Minutes between auto-syncs | 15 |
| **Auto-fill from Expressions** | Parse note content to pre-fill modal | true |
| **Autocomplete Enabled** | Enable smart autocomplete | true |
| **Quick Edit Enabled** | Enable quick edit modals | true |
| **Tooltips Enabled** | Show interactive tooltips | true |
| **Conflict Resolution** | How to handle conflicts | "manual" |

### Status Mapping

Customize how Linear statuses appear in your notes:

| Linear Status | Default Icon | Customizable |
|---------------|--------------|--------------|
| Todo | 📋 | ✅ |
| In Progress | 🔄 | ✅ |
| Done | ✅ | ✅ |
| Canceled | ❌ | ✅ |

Use the "Add Custom Status Mapping" button to add new status → emoji mappings.

### Advanced Settings

- **Comment Mirroring**: Sync Linear comments to notes
- **Kanban Generation**: Auto-generate kanban boards
- **Batch Operations**: Enable bulk operations
- **Secure Storage**: Encrypt stored tokens

## 🔧 Development

### Prerequisites

- Node.js 16+
- npm or yarn
- TypeScript 5.0+

### Setup

```bash
# Clone the repository
git clone https://github.com/your-username/obsidian-linear-plugin.git
cd obsidian-linear-plugin

# Install dependencies
npm install

# Start development
npm run dev
```

### Building

```bash
# Build for production
npm run build

# Run TypeScript checks
npm run typecheck

# Lint code
npm run lint

# Clean build artifacts
npm run clean
```

### Project Structure

```
src/
├── api/                 # Linear API client with retry logic
│   └── linear-client.ts
├── features/           # Plugin features
│   ├── autocomplete-system.ts    # Smart autocomplete with colors
│   ├── conflict-resolver.ts      # Intelligent conflict handling
│   └── local-config-system.ts   # Per-folder configuration
├── models/             # TypeScript types and interfaces
│   └── types.ts
├── parsers/            # Markdown and expression parsing
│   └── markdown-parser.ts
├── sync/               # Bidirectional sync management  
│   └── sync-manager.ts
├── ui/                 # User interface components
│   ├── issue-modal.ts            # Enhanced issue creation modal
│   └── settings-tab.ts          # Plugin settings with custom modals
├── utils/              # Utilities and helpers
│   └── frontmatter.ts
│   └── debug.ts
└── main.ts             # Main plugin entry point
```

## 🤝 Contributing

### Ways to Contribute

- 🐛 **Bug Reports**: Found an issue? Let us know!
- 💡 **Feature Requests**: Have an idea? We'd love to hear it!
- 🔧 **Code Contributions**: Submit PRs for fixes and features
- 🧪 **Testing**: Help test new features and releases

## 📄 License

This project is licensed under the AGPL-3.0 License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- The [Obsidian](https://obsidian.md) team for the amazing platform
- [Linear](https://linear.app) for the excellent API and GraphQL interface

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/casals/obsidian-linear-integration-plugin/issues)
- **Discussions**: [GitHub Discussions](https://github.com/casals/obsidian-linear-integration-plugin/discussions)

## 🔄 Recent Updates

### v1.0.0 - Major Release
- ✅ **Enhanced Autocomplete**: Color-coded suggestions with hierarchical labels
- ✅ **Auto-fill from Expressions**: Smart field population from note content  
- ✅ **Dynamic Label Creation**: Automatically create non-existent labels
- ✅ **Improved Tag Syntax**: Support for spaces in names and new tag types
- ✅ **Interactive Tooltips**: Hover previews with quick actions
- ✅ **Custom Status Mapping**: Easy emoji customization with modal interface
- ✅ **API Retry Logic**: Robust error handling with exponential backoff
- ✅ **Enhanced UI**: Loading states and better user feedback

## 🗺️ Roadmap

- [ ] **Webhooks**: Real-time updates via Linear webhooks
- [ ] **Advanced Querying**: Custom GraphQL query builder
- [ ] **Team Dashboards**: Team-specific views and metrics
- [ ] **Workflow Automation**: Custom automation rules
- [ ] **Mobile Support**: Enhanced mobile experience
- [ ] **Integrations**: Slack, Discord, email notifications
- [ ] **AI-Powered Suggestions**: Smart issue categorization and assignment

---

<div align="center">

**[⭐ Star us on GitHub](https://github.com/casals/obsidian-linear-integration-plugin)** | **[🐛 Report Issues](https://github.com/casals/obsidian-linear-integration-plugin/issues)**

Made with ❤️ for the Obsidian and Linear communities

</div>
