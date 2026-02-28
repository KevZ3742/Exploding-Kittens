# Exploding Kittens

An online implementation of the card game Exploding Kittens, allowing
players to play the chaotic and strategic card game through a web
interface.

## Overview

This project recreates the mechanics of Exploding Kittens in an online
environment so multiple players can play together remotely. Players draw
cards while trying to avoid the Exploding Kitten cards using strategy
cards like Defuse, Skip, Attack, and Shuffle.

## Features

-   Multiplayer gameplay
-   Web-based interface
-   Real-time interaction between players
-   Core Exploding Kittens card mechanics implemented

## Requirements

-   Node.js
-   npm

## Setup

1.  Clone the repository:

```{=html}
git clone https://github.com/KevZ3742/Exploding-Kittens.git
cd exploding kittens
```
    

2.  Install dependencies:

```{=html}
npm install
```
    

## Running the Project

Start the server:

    npm run start

Expose the server publicly using ngrok:

    ngrok http 3001

Players can then connect using the public URL provided by ngrok.

## Development

The server runs locally at:

    http://localhost:3001

Using ngrok allows external players to connect to your local game
server.
