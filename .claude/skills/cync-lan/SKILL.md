---
name: cync-lan
description: Start, stop, restart, or check status of the cync-lan Docker container
argument-hint: [start|stop|restart|logs|status]
disable-model-invocation: true
---

Manage the cync-lan Docker container that bridges Cync smart lights to MQTT.

The argument is: $ARGUMENTS

Run the start-cync-lan script based on the argument:

## If "start" or no argument

Run: `npx tsx scripts/start-cync-lan.ts`

This starts the container, reading MQTT settings from the project `.env` automatically.

## If "stop"

Run: `npx tsx scripts/start-cync-lan.ts --stop`

## If "restart"

Run: `npx tsx scripts/start-cync-lan.ts --restart`

This force-recreates the container, useful after changing `.env` or `cync_mesh.yaml`.

## If "logs"

Run: `npx tsx scripts/start-cync-lan.ts --logs`

Tails the container logs. Tell the user to press Ctrl-C to exit.

## If "status"

Run: `npx tsx scripts/start-cync-lan.ts --status`

## Important

- Docker Desktop must be running. If it isn't, tell the user to start it.
- MQTT settings are read from the project `.env` and passed to the container automatically — no need to edit docker-compose.yaml.
- The `cync_mesh.yaml` config must exist in `cync-lan/docker/config/` for the container to work. If the user hasn't set this up, point them to `/scan-rooms` or the cync-lan README.
- After starting, suggest the user check logs with `/cync-lan logs` to verify devices are connecting.
