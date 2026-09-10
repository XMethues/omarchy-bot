import type { PluginProviderDto, PluginProviderId, PluginServiceDto } from "./plugins.ts";

export interface PluginApiDefinition {
  baseUrl: string;
  pathPrefixes: string[];
  instructions: string;
}
export interface PluginServiceDefinition extends PluginServiceDto {
  scopes: string[];
  mcpUrl?: string;
  api?: PluginApiDefinition;
}
export interface PluginProviderDefinition extends Omit<PluginProviderDto, "services"> {
  services: PluginServiceDefinition[];
  authorizeUrl: string;
  tokenUrl: string;
  identityScopes: string[];
  tokenAuth: "post" | "none";
  tokenEncoding?: "json";
  pkce: boolean;
  scopeSeparator?: ",";
  authorizeParams?: Record<string, string>;
  clientMetadata?: boolean;
  registrationNote: string;
}

const GOOGLE_SCOPE = "https://www.googleapis.com/auth/";
const GRAPH_SCOPE = "https://graph.microsoft.com/";

/** Provider contracts are source-linked; OAuth credentials are supplied only by the publisher. */
export const PLUGIN_PROVIDERS: Record<PluginProviderId, PluginProviderDefinition> = {
  google: {
    id: "google", name: "Google", mode: "mcp",
    documentationUrl: "https://developers.google.com/workspace/guides/configure-mcp-servers",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token",
    identityScopes: ["openid", "email", "profile"], tokenAuth: "post", pkce: true,
    authorizeParams: { access_type: "offline", include_granted_scopes: "true", prompt: "consent select_account" },
    registrationNote: "Register a Web OAuth client and enable the three Workspace APIs and their MCP services. Restricted-scope verification and any applicable security assessment are required for public distribution.",
    services: [
      { id: "google-drive", name: "Google Drive", description: "Search and read files; create or update app-authorized files.",
        scopes: [`${GOOGLE_SCOPE}drive.readonly`, `${GOOGLE_SCOPE}drive.file`], mcpUrl: "https://drivemcp.googleapis.com/mcp/v1" },
      { id: "gmail", name: "Gmail", description: "Search and read mail; compose drafts and send messages.",
        scopes: [`${GOOGLE_SCOPE}gmail.readonly`, `${GOOGLE_SCOPE}gmail.compose`], mcpUrl: "https://gmailmcp.googleapis.com/mcp/v1",
        api: { baseUrl: "https://gmail.googleapis.com", pathPrefixes: ["/gmail/v1/users/me/"], instructions: "Gmail REST API for the selected account. GET /gmail/v1/users/me/messages supports q/maxResults/pageToken; GET .../messages/{id}?format=full reads message content. POST .../drafts body {message:{raw:base64urlRFC2822MIME}} creates a draft; PUT .../drafts/{id} updates it. POST .../drafts/send body {id:draftId} or POST .../messages/send body {raw:base64urlRFC2822MIME} sends mail. The gmail.compose grant permits drafts and sending, not mailbox modification or deletion. Return provider IDs and pagination; do not imply delivery from send acceptance. Reference: https://developers.google.com/workspace/gmail/api/guides/sending" } },
      { id: "google-calendar", name: "Google Calendar", description: "Discover calendars, check availability, and manage events.",
        scopes: [`${GOOGLE_SCOPE}calendar.calendarlist.readonly`, `${GOOGLE_SCOPE}calendar.events.readonly`, `${GOOGLE_SCOPE}calendar.events.freebusy`, `${GOOGLE_SCOPE}calendar.events`],
        mcpUrl: "https://calendarmcp.googleapis.com/mcp/v1",
        api: { baseUrl: "https://www.googleapis.com", pathPrefixes: ["/calendar/v3/"], instructions: "Google Calendar REST API. GET /calendar/v3/users/me/calendarList discovers calendars. GET/POST /calendar/v3/calendars/{calendarId}/events lists/creates events; GET/PATCH/DELETE .../events/{eventId} reads/updates/deletes. Use URL-encoded IDs. List query supports timeMin/timeMax RFC3339, q, singleEvents and pageToken. Event start/end must carry dateTime/timeZone or all-day date. MCP read/freebusy scope alone does not authorize writes; this tool uses the explicit calendar.events grant. Reference: https://developers.google.com/workspace/calendar/api/v3/reference" } },
    ],
  },
  microsoft: {
    id: "microsoft", name: "Microsoft", mode: "api", documentationUrl: "https://learn.microsoft.com/en-us/graph/overview",
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    identityScopes: ["openid", "profile", "email", "offline_access", `${GRAPH_SCOPE}User.Read`], tokenAuth: "post", pkce: true,
    authorizeParams: { prompt: "consent" },
    registrationNote: "Register an Entra Web application for organizational and personal accounts with delegated Graph permissions. Tenant consent and service provisioning still apply; Work IQ MCP is a separately licensed preview.",
    services: [
      { id: "outlook-mail", name: "Outlook Mail", description: "Read and manage mail, drafts, and sending.", scopes: [`${GRAPH_SCOPE}Mail.ReadWrite`, `${GRAPH_SCOPE}Mail.Send`],
        api: { baseUrl: "https://graph.microsoft.com", pathPrefixes: ["/v1.0/me/messages", "/v1.0/me/mailFolders", "/v1.0/me/sendMail"], instructions: "Microsoft Graph delegated Outlook mail. GET /v1.0/me/messages with $search/$select/$top; GET /v1.0/me/messages/{id}; POST /v1.0/me/messages creates a draft; PATCH draft or DELETE message; POST /v1.0/me/messages/{id}/send sends draft. POST /v1.0/me/sendMail body {message:{subject,body:{contentType:'Text',content},toRecipients:[{emailAddress:{address}}]}}. HTTP 202 means accepted, not delivered. Follow @odata.nextLink through its relative path/query, not a new origin. Reference: https://learn.microsoft.com/en-us/graph/api/resources/message" } },
      { id: "outlook-calendar", name: "Outlook Calendar", description: "Read calendars and recurring occurrences; manage events.", scopes: [`${GRAPH_SCOPE}Calendars.ReadWrite`],
        api: { baseUrl: "https://graph.microsoft.com", pathPrefixes: ["/v1.0/me/calendars", "/v1.0/me/calendarView", "/v1.0/me/events"], instructions: "Microsoft Graph calendar. GET /v1.0/me/calendars. GET /v1.0/me/calendars/{id}/calendarView with startDateTime/endDateTime expands recurring occurrences. POST .../events creates; GET/PATCH/DELETE /v1.0/me/events/{id} reads/updates/deletes. Use subject, start/end {dateTime,timeZone}, attendees. Do not invent arbitrary $search support for calendarView. Reference: https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview" } },
      { id: "onedrive", name: "OneDrive", description: "Search, read, create, and update the signed-in user’s files.", scopes: [`${GRAPH_SCOPE}Files.ReadWrite`],
        api: { baseUrl: "https://graph.microsoft.com", pathPrefixes: ["/v1.0/me/drive"], instructions: "Microsoft Graph OneDrive. GET /v1.0/me/drive/root/children; GET /v1.0/me/drive/root/search(q='escaped text'); GET /v1.0/me/drive/items/{id} metadata or .../content bytes. PUT /v1.0/me/drive/root:/{path}:/content creates; PUT /v1.0/me/drive/items/{id}/content replaces using bodyBase64/contentType; PATCH item changes metadata. Keep drive and item IDs. Content downloads may return a preauthenticated Location; do not treat that URL as requiring this account's bearer token. Reference: https://learn.microsoft.com/en-us/graph/api/resources/driveitem" } },
    ],
  },
  notion: {
    id: "notion", name: "Notion", mode: "mcp", documentationUrl: "https://developers.notion.com/guides/mcp/build-mcp-client",
    authorizeUrl: "https://mcp.notion.com/authorize", tokenUrl: "https://mcp.notion.com/token", identityScopes: [], tokenAuth: "none", pkce: true, clientMetadata: true,
    registrationNote: "Uses Notion’s documented public Client ID Metadata Document flow with PKCE. Workspace policy and individual tool entitlements still apply.",
    services: [{ id: "notion", name: "Notion", description: "Work with authorized workspace content through Notion MCP.", scopes: ["default"], mcpUrl: "https://mcp.notion.com/mcp" }],
  },
  github: {
    id: "github", name: "GitHub", mode: "mcp", documentationUrl: "https://github.com/github/github-mcp-server/blob/main/docs/host-integration.md",
    authorizeUrl: "https://github.com/login/oauth/authorize", tokenUrl: "https://github.com/login/oauth/access_token", identityScopes: ["read:user"], tokenAuth: "post", pkce: true,
    authorizeParams: { prompt: "select_account" },
    registrationNote: "Register a publisher GitHub OAuth App. Repository scopes are broad; organization approval, SSO and tool-specific permissions still apply.",
    services: [{ id: "github", name: "GitHub", description: "Repositories, issues, pull requests, and organization context.", scopes: ["repo", "read:org"], mcpUrl: "https://api.githubcopilot.com/mcp/" }],
  },
  linear: {
    id: "linear", name: "Linear", mode: "mcp", documentationUrl: "https://linear.app/docs/mcp",
    authorizeUrl: "https://linear.app/oauth/authorize", tokenUrl: "https://api.linear.app/oauth/token", identityScopes: [], tokenAuth: "post", pkce: true, scopeSeparator: ",",
    authorizeParams: { prompt: "consent" },
    registrationNote: "Register a Linear OAuth application; its ordinary OAuth tokens are explicitly supported by Linear MCP. Each workspace uses its own grant.",
    services: [{ id: "linear", name: "Linear", description: "Read and update issues and project work in the authorized workspace.", scopes: ["read", "write"], mcpUrl: "https://mcp.linear.app/mcp" }],
  },
  asana: {
    id: "asana", name: "Asana", mode: "mcp", documentationUrl: "https://developers.asana.com/docs/integrating-with-asanas-mcp-server",
    authorizeUrl: "https://app.asana.com/-/oauth_authorize", tokenUrl: "https://app.asana.com/-/oauth_token", identityScopes: [], tokenAuth: "post", pkce: true,
    authorizeParams: { resource: "https://mcp.asana.com/v2" },
    registrationNote: "Register an Asana MCP app, not an API app, and configure workspace distribution. MCP tokens cannot call Asana REST APIs; some tools require paid plans.",
    services: [{ id: "asana", name: "Asana", description: "Tasks and projects in the workspace selected during authorization.", scopes: [], mcpUrl: "https://mcp.asana.com/v2/mcp" }],
  },
  dropbox: {
    id: "dropbox", name: "Dropbox", mode: "mcp", documentationUrl: "https://help.dropbox.com/integrations/connect-dropbox-mcp-server",
    authorizeUrl: "https://www.dropbox.com/oauth2/authorize", tokenUrl: "https://api.dropboxapi.com/oauth2/token", identityScopes: ["account_info.read"], tokenAuth: "post", pkce: true,
    authorizeParams: { token_access_type: "offline" },
    registrationNote: "Register a Scoped access / Full Dropbox application for this publisher. Arbitrary-client DCR is restricted; production approval and team policy apply.",
    services: [{ id: "dropbox", name: "Dropbox", description: "Files, folders, search, sharing, and file requests.", scopes: ["files.metadata.read", "files.content.read", "files.content.write", "sharing.write", "sharing.read", "file_requests.read", "file_requests.write"], mcpUrl: "https://mcp.dropbox.com/mcp" }],
  },
  hubspot: {
    id: "hubspot", name: "HubSpot", mode: "mcp", documentationUrl: "https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server",
    authorizeUrl: "https://mcp.hubspot.com/oauth/authorize/user", tokenUrl: "https://mcp.hubspot.com/oauth/v3/token", identityScopes: [], tokenAuth: "post", pkce: true,
    registrationNote: "Register a HubSpot MCP auth app. Do not use an ordinary CRM app or hardcode its scopes; MCP grants and record permissions are provider-managed.",
    services: [{ id: "hubspot", name: "HubSpot", description: "CRM tools governed by the authorizing user’s record permissions.", scopes: [], mcpUrl: "https://mcp.hubspot.com/" }],
  },
  intercom: {
    id: "intercom", name: "Intercom", mode: "mcp", documentationUrl: "https://developers.intercom.com/docs/guides/mcp",
    authorizeUrl: "https://app.intercom.com/oauth", tokenUrl: "https://api.intercom.io/auth/eagle/token", identityScopes: [], tokenAuth: "post", tokenEncoding: "json", pkce: false,
    registrationNote: "Register and obtain review for an Intercom public OAuth app with the documented contact, conversation and article permissions. US authorization is used; MCP does not support Australian workspaces. Ordinary API OAuth tokens are accepted by MCP and do not have a documented refresh grant.",
    services: [{ id: "intercom", name: "Intercom", description: "Contacts, conversations, articles, and internal notes.", scopes: [], mcpUrl: "https://mcp.intercom.com/mcp" }],
  },
  miro: {
    id: "miro", name: "Miro", mode: "api", documentationUrl: "https://developers.miro.com/docs/getting-started-with-oauth",
    authorizeUrl: "https://miro.com/oauth/authorize", tokenUrl: "https://api.miro.com/v1/oauth/token", identityScopes: [], tokenAuth: "post", pkce: false,
    registrationNote: "Register a Miro developer OAuth app with board permissions. Direct API is used because published MCP client-auth and identity metadata conflict. Authorization is team-specific; API board/item operations are not MCP semantic-generation features.",
    services: [{ id: "miro", name: "Miro", description: "Read and update boards and items in the authorized team.", scopes: ["boards:read", "boards:write"],
      api: { baseUrl: "https://api.miro.com", pathPrefixes: ["/v2/boards"], instructions: "Miro REST board and item API. GET/POST /v2/boards; GET/PATCH /v2/boards/{boardId}; GET /v2/boards/{boardId}/items; typed item endpoints include sticky_notes, shapes, text and cards. Use provider schema and cursor pagination. API does not provide MCP semantic diagram generation. Reference: https://developers.miro.com/reference/api-reference" } }],
  },
};
