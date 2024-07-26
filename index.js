const fs = require("fs");
const http = require("http");
const https = require("https");
const crypto = require("crypto");

const {
  OPENAI_KEY,
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
} = require("./auth/cred.json");

const port = 3000;
const redirect_uri = "http://localhost:3000/callback";

const server = http.createServer();

server.on("listening", listen_handler);
server.listen(port);
function listen_handler() {
  console.log(`Now Listening on Port ${port}`);
}

server.on("request", request_handler);
function request_handler(req, res) {
  console.log(`New Request from ${req.socket.remoteAddress} for ${req.url}`);
  if (req.url === "/") {
    const state = crypto.randomBytes(20).toString("hex");
    const cache_path = "./auth/access_token.json";
    let cache_valid = false;
    if (fs.existsSync(cache_path)) {
      cached_token = require(cache_path);
      if (new Date(cached_token.expiration) > Date.now()) {
        cache_valid = true;
      }
    }

    if (cache_valid) {
      console.log("cached token");
      get_profile(res, cached_token.access_token);
    } else {
      console.log("new access token");
      redirect_to_spotify(res, state);
    }
  } else if (req.url.startsWith("/callback")) {
    const user_input = new URL(req.url, `https://${req.headers.host}`)
      .searchParams;
    const code = user_input.get("code");
    const state = user_input.get("state");
    request_access_token(res, code, state);
  }
}

function redirect_to_spotify(res, state) {
  const scope =
    "playlist-read-private, playlist-modify-private, playlist-modify-public";
  const authorization_endpoint = "https://accounts.spotify.com/authorize";
  let uri = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: "code",
    state: state,
    scope: scope,
    redirect_uri: redirect_uri,
  }).toString();
  res.writeHead(302, { Location: `${authorization_endpoint}?${uri}` }).end();
}

function request_access_token(res, code, state) {
  let base64 = Buffer.from(
    `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`,
  ).toString("base64");

  options = {
    method: "POST",
    headers: {
      "Content-Type": `application/x-www-form-urlencoded`,
      Authorization: `basic ${base64}`,
    },
  };

  const token_endpoint = "https://accounts.spotify.com/api/token";
  let post_data = new URLSearchParams({
    grant_type: "authorization_code",
    state: state,
    code: code,
    redirect_uri: redirect_uri,
  }).toString();

  const access_token_time = new Date();

  https
    .request(token_endpoint, options, (token_stream) =>
      process_stream(
        token_stream,
        receive_access_token,
        access_token_time,
        res,
      ),
    )
    .end(post_data);
}

function process_stream(stream, callback, ...args) {
  let body = "";
  stream.on("data", (chunk) => (body += chunk));
  stream.on("end", () => callback(body, ...args));
}

function receive_access_token(body, access_token_time, res) {
  const token_object = JSON.parse(body);
  const access_token = token_object.access_token;
  access_token_cache(token_object, access_token_time);
  get_profile(res, access_token);
}

function access_token_cache(token_object, access_token_time) {
  token_object.expiration = new Date(
    access_token_time.getTime() + token_object.expires_in * 1000,
  );
  fs.writeFile(
    "./auth/access_token.json",
    JSON.stringify(token_object),
    () => {},
  );
}

function get_profile(res, access_token) {
  const spotify_endpoint = "https://api.spotify.com/v1/me";
  const profile = https.get(spotify_endpoint, {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  profile.on("response", (stream) => {
    process_stream(stream, parse_profile, access_token, res);
  });
}

function parse_profile(body, access_token, res) {
  let { id, display_name, uri } = JSON.parse(body);
  get_playlist({ id, display_name, uri }, access_token, res);
}

function get_playlist({ id, display_name, uri }, access_token, res) {
  const endpoint = `https://api.spotify.com/v1/users/${id}/playlists`;
  const playlist = https.get(endpoint, {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  playlist.on("response", (stream) => {
    process_stream(stream, parse_playlist, access_token, res);
  });
}

function parse_playlist(body, access_token, res) {
  let playlist_object = JSON.parse(body);
  const first_playlist = playlist_object?.items[0]?.id;
  const endpoint = `https://api.spotify.com/v1/playlists/${first_playlist}`;
  const songs = https.get(endpoint, {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  songs.on("response", (stream) => {
    process_stream(stream, get_songs, access_token, res);
  });
  res.end();
}

function get_songs(body, access_token, res) {
  let songs_object = JSON.parse(body);
  let song_arr = [];
  let songs = "";
  let num_of_songs = songs_object?.tracks?.total;
  console.log(num_of_songs);

  for (let i = num_of_songs - 1; i > num_of_songs - 4; i--) {
    song_arr.push({
      name: `${songs_object?.tracks?.items[i]?.track?.name}`,
      added_at: `${songs_object?.tracks?.items[i]?.added_at}`,
    });
    songs += `${songs_object?.tracks?.items[i]?.track?.name}, `;
  }

  let openai_search = `find 3 song recommendations based on these 3 songs ${songs} and return the that as a json object!`;
  openAI(openai_search);
  console.log(openai_search);
}

function openAI(openai_search, res) {
  const endpoint = "https://api.openai.com/v1/completions";
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
  };

  let model = {
    model: "gpt-3.5-turbo",
    messages: [
      {
        role: "user",
        content: `${openai_search}`,
      },
    ],
    temperature: 0.4,
    max_tokens: 200,
  };

  const recs = https.request(endpoint, options, model);

  recs.on("response", (stream) => {
    process_stream(stream, parse_openai, res);
  });
}

function parse_openai(body, res) {
  console.log(body);
  const openai = JSON.parse(body);
  console.log(openai);
  // const content = openai.choices[0].message.content;

  //   const jsonResponse = JSON.parse(content);
  //   console.log(jsonResponse);
  // } catch (error) {
  //   console.error("Failed to parse JSON:", error);
  //   console.log("Raw content:", content);
  // }
}

function add_song(res, playlist_id) {
  const endpoint = `https://api.spotify.com/v1/playlists/${playlist_id}/tracks`;
  const add_playlist = https.get(endpoint, {
    headers: {
      Authorization: `Bearer ${access_token}`,
      "Content-Type": `application/x-www-form-urlencoded`,
    },
  });
  let body = { uris: ["spotify:track:4iV5W9uYEdYUVa79Axb7Rh"], position: 0 };
  add_playlist.on("response", (stream) => {
    process_stream(stream, access_token, res);
  });
}
