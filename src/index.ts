#!/usr/bin/env node

import * as dotenv from 'dotenv';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

import { JiraService } from './services/JiraService.js';
import * as schemas from './types/index.js';

// Load environment variables
dotenv.config();

// Initialize logging level
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const isDebug = LOG_LEVEL === 'debug';

/**
 * Custom logging function that respects log level
 */
function log(message: string, level = 'info'): void {
  const levels = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  };
  
  const configuredLevel = levels[LOG_LEVEL as keyof typeof levels] || 1;
  const messageLevel = levels[level as keyof typeof levels] || 1;
  
  if (messageLevel >= configuredLevel) {
    const prefix = `[${level.toUpperCase()}]`;
    console.log(`${prefix} ${message}`);
  }
}

/**
 * Main Jira MCP Server class
 */
class JiraServer {
  private readonly server: Server;
  private readonly jiraService: JiraService;
  private readonly toolDefinitions = {
    get_user: {
      description: "Get a user's account ID by their email address",
      inputSchema: {
        type: "object",
        properties: {
          email: {
            type: "string",
            description: "Email address of the user",
          },
        },
        required: ["email"],
      },
    },
    get_project: {
      description: "Get information about a Jira project",
      inputSchema: {
        type: "object",
        properties: {
          projectKey: {
            type: "string",
            description: "Key of the project to get information for",
          },
          expand: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Optional list of properties to expand (e.g., 'lead', 'description', 'url', etc.)",
          },
        },
        required: ["projectKey"],
      },
    },
    list_issue_types: {
      description: "List all available issue types in the Jira instance",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    list_fields: {
      description: "List all available fields in the Jira instance",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    list_link_types: {
      description: "List all available issue link types in the Jira instance",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    get_issues: {
      description: "Get all issues and subtasks for a project, optionally filtered by JQL",
      inputSchema: {
        type: "object",
        properties: {
          projectKey: {
            type: "string",
            description: "Key of the project to get issues from",
          },
          jql: {
            type: "string",
            description: "Optional JQL query to filter issues",
          },
          maxResults: {
            type: "number",
            description: "Maximum number of results to return (default: 50, max: 100)",
          },
          fields: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Optional list of fields to include in the response",
          },
        },
        required: ["projectKey"],
      },
    },
    create_issue: {
      description: "Create a new issue or subtask in Jira",
      inputSchema: {
        type: "object",
        properties: {
          projectKey: {
            type: "string",
            description: "Key of the project to create the issue in",
          },
          summary: {
            type: "string",
            description: "Issue title/summary",
          },
          issueType: {
            type: "string",
            description: "Type of issue (e.g., 'Task', 'Story', 'Bug', 'Subtask')",
          },
          description: {
            type: "string",
            description: "Detailed description of the issue",
          },
          assignee: {
            type: "string",
            description: "Email of user to assign the issue to",
          },
          labels: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Labels to apply to the issue",
          },
          components: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Components to associate with the issue",
          },
          priority: {
            type: "string",
            description: "Priority level (e.g., 'High', 'Medium', 'Low')",
          },
          parent: {
            type: "string",
            description: "Parent issue key (required for subtasks)",
          },
          customFields: {
            type: "object",
            description: "Custom fields to set on the issue",
          },
        },
        required: ["projectKey", "summary", "issueType"],
      },
    },
    update_issue: {
      description: "Update an existing issue in Jira",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: {
            type: "string",
            description: "Key of the issue to update (e.g., 'PROJECT-123')",
          },
          summary: {
            type: "string",
            description: "Updated issue title/summary",
          },
          description: {
            type: "string",
            description: "Updated issue description",
          },
          assignee: {
            type: "string",
            description: "Email of user to assign the issue to",
          },
          status: {
            type: "string",
            description: "New status for the issue",
          },
          priority: {
            type: "string",
            description: "Updated priority level",
          },
          labels: {
            type: "array",
            items: {
              type: "string",
            },
            description: "New labels to set for the issue (replaces existing labels)",
          },
          components: {
            type: "array",
            items: {
              type: "string",
            },
            description: "New components to set for the issue (replaces existing components)",
          },
          customFields: {
            type: "object",
            description: "Custom fields to update on the issue",
          },
        },
        required: ["issueKey"],
      },
    },
    bulk_update_issues: {
      description: "Update multiple issues at once with the same changes",
      inputSchema: {
        type: "object",
        properties: {
          issueKeys: {
            type: "array",
            items: {
              type: "string",
            },
            description: "List of issue keys to update",
          },
          summary: {
            type: "string",
            description: "Updated issue title/summary",
          },
          description: {
            type: "string",
            description: "Updated issue description",
          },
          assignee: {
            type: "string",
            description: "Email of user to assign the issues to",
          },
          status: {
            type: "string",
            description: "New status for the issues",
          },
          priority: {
            type: "string",
            description: "Updated priority level",
          },
          addLabels: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Labels to add to the issues (keeps existing labels)",
          },
          removeLabels: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Labels to remove from the issues",
          },
          setLabels: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Labels to set for the issues (replaces existing labels)",
          },
          addComponents: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Components to add to the issues (keeps existing components)",
          },
          removeComponents: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Components to remove from the issues",
          },
          setComponents: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Components to set for the issues (replaces existing components)",
          },
          customFields: {
            type: "object",
            description: "Custom fields to update on the issues",
          },
        },
        required: ["issueKeys"],
      },
    },
    create_issue_link: {
      description: "Create a link between two issues",
      inputSchema: {
        type: "object",
        properties: {
          inwardIssueKey: {
            type: "string",
            description: "Key of the inward issue (e.g., 'PROJECT-123')",
          },
          outwardIssueKey: {
            type: "string",
            description: "Key of the outward issue (e.g., 'PROJECT-124')",
          },
          linkType: {
            type: "string",
            description: "Type of link (e.g., 'Blocks', 'Relates to')",
          },
          comment: {
            type: "string",
            description: "Optional comment to add to the link",
          },
        },
        required: ["inwardIssueKey", "outwardIssueKey", "linkType"],
      },
    },
    delete_issue: {
      description: "Delete a Jira issue or subtask",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: {
            type: "string",
            description: "Key of the issue to delete",
          },
          deleteSubtasks: {
            type: "boolean",
            description: "Whether to also delete subtasks",
          },
        },
        required: ["issueKey"],
      },
    },
    bulk_delete_issues: {
      description: "Delete multiple Jira issues",
      inputSchema: {
        type: "object",
        properties: {
          issueKeys: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Keys of the issues to delete",
          },
        },
        required: ["issueKeys"],
      },
    },
    get_transitions: {
      description: "Get available status transitions for an issue",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: {
            type: "string",
            description: "Key of the issue to get transitions for",
          },
        },
        required: ["issueKey"],
      },
    },
    transition_issue: {
      description: "Transition an issue to a new status",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: {
            type: "string",
            description: "Key of the issue to transition",
          },
          transitionId: {
            type: "string",
            description: "ID of the transition to perform",
          },
          transitionName: {
            type: "string",
            description: "Name of the transition to perform (alternative to transitionId)",
          },
          comment: {
            type: "string",
            description: "Comment to add with the transition",
          },
          resolution: {
            type: "string",
            description: "Resolution to set (for issues being resolved)",
          },
          fields: {
            type: "object",
            description: "Additional fields to set during the transition",
          },
        },
        required: ["issueKey"],
      },
    },
    add_comment: {
      description: "Add a comment to an issue",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: {
            type: "string",
            description: "Key of the issue to comment on",
          },
          body: {
            type: "string",
            description: "Text of the comment (supports Markdown formatting)",
          },
          visibility: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: ["group", "role"],
                description: "Type of visibility restriction",
              },
              value: {
                type: "string",
                description: "Name of the group or role",
              },
            },
            required: ["type", "value"],
            description: "Visibility restrictions for the comment",
          },
        },
        required: ["issueKey", "body"],
      },
    },
    add_watcher: {
      description: "Add a watcher to an issue",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: {
            type: "string",
            description: "Key of the issue to add watcher to",
          },
          username: {
            type: "string",
            description: "Email of the user to add as watcher",
          },
        },
        required: ["issueKey", "username"],
      },
    },
  };

  /**
   * Create a new JiraServer instance
   */
  constructor() {
    this.server = new Server({
      title: "Jira Server",
      description: "MCP server for interacting with Jira",
      version: "1.0.0",
      transport: new StdioServerTransport(),
    });

    try {
      this.jiraService = new JiraService();
      this.setupToolHandlers();
      log("JiraServer initialized successfully", "info");
    } catch (error: any) {
      log(`Failed to initialize JiraServer: ${error.message}`, "error");
      process.exit(1);
    }
  }

  /**
   * Set up handlers for all tools
   */
  private setupToolHandlers(): void {
    // Set up message handlers for list_tools and call_tool requests
    this.server.onListTools((request: ListToolsRequestSchema) => {
      log("Handling list_tools request", "debug");
      return {
        tools: Object.entries(this.toolDefinitions).map(([name, definition]) => ({
          name,
          description: definition.description,
          input_schema: definition.inputSchema,
        })),
      };
    });

    this.server.onCallTool(async (request: CallToolRequestSchema) => {
      const { tool, arguments: args } = request;
      log(`Handling call_tool request for tool: ${tool}`, "debug");
      
      if (isDebug) {
        log(`Tool arguments: ${JSON.stringify(args, null, 2)}`, "debug");
      }

      try {
        switch (tool) {
          case "get_user":
            return {
              output: await this.jiraService.getUserAccountId(schemas.GetUserSchema.parse(args)),
            };

          case "get_project":
            return {
              output: await this.jiraService.getProject(schemas.GetProjectSchema.parse(args)),
            };

          case "list_issue_types":
            return {
              output: await this.jiraService.listIssueTypes(),
            };

          case "list_fields":
            return {
              output: await this.jiraService.listFields(),
            };

          case "list_link_types":
            return {
              output: await this.jiraService.listLinkTypes(),
            };

          case "get_issues":
            return {
              output: await this.jiraService.getIssues(schemas.GetIssuesSchema.parse(args)),
            };

          case "create_issue":
            return {
              output: await this.jiraService.createIssue(schemas.CreateIssueSchema.parse(args)),
            };

          case "update_issue":
            return {
              output: await this.jiraService.updateIssue(schemas.UpdateIssueSchema.parse(args)),
            };

          case "bulk_update_issues":
            return {
              output: await this.jiraService.bulkUpdateIssues(schemas.BulkUpdateIssuesSchema.parse(args)),
            };

          case "create_issue_link":
            return {
              output: await this.jiraService.createIssueLink(schemas.CreateIssueLinkSchema.parse(args)),
            };

          case "delete_issue":
            return {
              output: await this.jiraService.deleteIssue(schemas.DeleteIssueSchema.parse(args)),
            };

          case "bulk_delete_issues":
            return {
              output: await this.jiraService.bulkDeleteIssues(schemas.BulkDeleteIssuesSchema.parse(args)),
            };

          case "get_transitions":
            return {
              output: await this.jiraService.getTransitions(schemas.GetTransitionsSchema.parse(args)),
            };

          case "transition_issue":
            return {
              output: await this.jiraService.transitionIssue(schemas.TransitionIssueSchema.parse(args)),
            };

          case "add_comment":
            return {
              output: await this.jiraService.addComment(schemas.AddCommentSchema.parse(args)),
            };

          case "add_watcher":
            return {
              output: await this.jiraService.addWatcher(schemas.AddWatcherSchema.parse(args)),
            };

          default:
            log(`Tool not found: ${tool}`, "error");
            throw new McpError(
              ErrorCode.TOOL_NOT_FOUND,
              `Tool "${tool}" not found. Available tools: ${Object.keys(
                this.toolDefinitions
              ).join(", ")}`
            );
        }
      } catch (error: any) {
        // Special handling for Zod validation errors
        if (error.name === 'ZodError') {
          log(`Invalid arguments for tool ${tool}: ${error.message}`, "error");
          throw new McpError(
            ErrorCode.INVALID_ARGUMENTS,
            `Invalid arguments for tool "${tool}": ${error.message}`
          );
        }
        
        // Handle various error types
        if (error instanceof McpError) {
          throw error;
        }
        
        log(`Error in tool "${tool}": ${error.message}`, "error");
        throw new McpError(
          ErrorCode.TOOL_EXECUTION_ERROR,
          `Error executing tool "${tool}": ${error.message}`
        );
      }
    });
  }

  /**
   * Start the server
   */
  public async run(): Promise<void> {
    log("Starting JiraServer...", "info");
    await this.server.listen();
  }
}

// Create and run the server
const server = new JiraServer();
server.run().catch((error) => {
  log(`Server error: ${error.message}`, "error");
  process.exit(1);
}); 