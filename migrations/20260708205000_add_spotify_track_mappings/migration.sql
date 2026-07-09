CREATE TABLE "SpotifyTrackMapping" (
    "spotifyTrackId" TEXT NOT NULL PRIMARY KEY,
    "spotifyUrl" TEXT NOT NULL,
    "spotifyName" TEXT NOT NULL,
    "spotifyArtist" TEXT NOT NULL,
    "spotifyDurationMs" INTEGER,
    "youtubeVideoId" TEXT NOT NULL,
    "youtubeUrl" TEXT NOT NULL,
    "youtubeTitle" TEXT NOT NULL,
    "confirmedByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
