CREATE TABLE "PlayerSession" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "voiceChannelId" TEXT,
    "textChannelId" TEXT,
    "status" INTEGER NOT NULL,
    "queue" TEXT NOT NULL,
    "queuePosition" INTEGER NOT NULL DEFAULT 0,
    "positionInSeconds" INTEGER NOT NULL DEFAULT 0,
    "loopCurrentSong" BOOLEAN NOT NULL DEFAULT false,
    "loopCurrentQueue" BOOLEAN NOT NULL DEFAULT false,
    "volume" INTEGER,
    "updatedAt" DATETIME NOT NULL
);
