export const TYPES = {
  Bot: Symbol('Bot'),
  KeyValueCache: Symbol('KeyValueCache'),
  FileCache: Symbol('FileCache'),
  Client: Symbol('Client'),
  Config: Symbol('Config'),
  Command: Symbol('Command'),
  ThirdParty: Symbol('ThirdParty'),
  Managers: {
    Player: Symbol('PlayerManager'),
  },
  Services: {
    AddQueryToQueue: Symbol('AddQueryToQueue'),
    ButtonChoicePrompt: Symbol('ButtonChoicePrompt'),
    GetSongs: Symbol('GetSongs'),
    OfficialBandcampResolver: Symbol('OfficialBandcampResolver'),
    SpotifyQueueResolver: Symbol('SpotifyQueueResolver'),
    SpotifyTrackResolver: Symbol('SpotifyTrackResolver'),
    YoutubeAPI: Symbol('YoutubeAPI'),
    SpotifyAPI: Symbol('SpotifyAPI'),
  },
};
