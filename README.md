# Linad Linera buildathon submission

This repo provides a Docker setup with all the necessary dependencies to build and run a local Linera application against the Linera test network.

`run.bash` runs this app against the Linera testnet (testnet-conway): it starts a Linera GraphQL backend (`linera service`) that talks to the testnet validators (e.g. `grpcs:validator-*.testnet-conway.linera.net:443`, with genesis config derived from the testnet faucet at `https://faucet.testnet-conway.linera.net`), and it also starts the Next.js frontend on port 5173.

Demo:

## Structure

This repo includes a `Dockerfile` with the dependencies needed for Linera + frontend development, plus a `compose.yaml` that mounts the repo at `/build` and exposes the following ports:

- 5173: the frontend of your application (optional)
- 8080: the Linera GraphQL backend (`linera service`; it serves GraphQL to the frontend and acts as a client to validators)

Please keep this port structure, and make sure the `Dockerfile` or the
`compose.yaml` defines a reasonable healthcheck for your app (the
default waits for your frontend to be served on `localhost:5173`).
Other internal structure is optional; feel free to change it.

## Usage

Start the app with:

```bash
docker compose up --force-recreate
```

Then open:
- Frontend: `http://127.0.0.1:5173`
- Linera GraphQL (GraphiQL): `http://127.0.0.1:8080`
