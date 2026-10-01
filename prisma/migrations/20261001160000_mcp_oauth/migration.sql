CREATE TABLE IF NOT EXISTS "McpClient" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "redirectUris" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "McpClient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "McpAuthCode" (
    "codeHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "McpAuthCode_pkey" PRIMARY KEY ("codeHash")
);

CREATE INDEX IF NOT EXISTS "McpAuthCode_expiresAt_idx" ON "McpAuthCode"("expiresAt");

CREATE TABLE IF NOT EXISTS "McpToken" (
    "tokenHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "McpToken_pkey" PRIMARY KEY ("tokenHash")
);

CREATE INDEX IF NOT EXISTS "McpToken_familyId_idx" ON "McpToken"("familyId");
CREATE INDEX IF NOT EXISTS "McpToken_expiresAt_idx" ON "McpToken"("expiresAt");
