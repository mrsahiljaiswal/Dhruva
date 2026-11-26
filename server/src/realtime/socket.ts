import type { Server as HttpServer } from "node:http";
import { socketJoinSchema, socketSendSchema } from "@dhruva/shared";
import type { RequestHandler } from "express";
import { Server } from "socket.io";
import type { MessagingService } from "../modules/messaging/service.js";
import type { UserRepository } from "../modules/users/repository.js";
import { isSessionExpired } from "../policies/authenticate.js";
import type { Delivery, DeliveryBridge } from "./delivery.js";

type HandshakeRequest = {
  session?: { userId?: string; issuedAt?: number };
};

function listenersOf(counts: Map<string, Map<string, number>>, conversationId: string): string[] {
  const room = counts.get(conversationId);
  if (!room) {
    return [];
  }
  return [...room.entries()].filter(([, count]) => count > 0).map(([userId]) => userId);
}

function changeCount(counts: Map<string, Map<string, number>>, conversationId: string, userId: string, delta: number): void {
  const room = counts.get(conversationId) ?? new Map<string, number>();
  const next = (room.get(userId) ?? 0) + delta;
  if (next <= 0) {
    room.delete(userId);
  } else {
    room.set(userId, next);
  }
  if (room.size === 0) {
    counts.delete(conversationId);
  } else {
    counts.set(conversationId, room);
  }
}

export function attachRealtime(
  httpServer: HttpServer,
  options: {
    clientOrigin: string;
    session: RequestHandler;
    users: UserRepository;
    messaging: MessagingService;
    bridge: DeliveryBridge;
  },
): { close(): Promise<void> } {
  const io = new Server(httpServer, {
    cors: { origin: options.clientOrigin, credentials: true },
  });
  const counts = new Map<string, Map<string, number>>();

  const delivery: Delivery = {
    listeners: (conversationId) => listenersOf(counts, conversationId),
    messageNew(conversationId) {
      io.to(`conversation:${conversationId}`).emit("message.new", { conversationId });
    },
    messageRead(conversationId, userId, messageId) {
      io.to(`conversation:${conversationId}`).emit("message.read", { conversationId, userId, messageId });
    },
    typing(conversationId, userId) {
      io.to(`conversation:${conversationId}`).emit("typing", { conversationId, userId });
    },
    notificationNew(userId) {
      io.to(`user:${userId}`).emit("notification.new", {});
    },
  };
  options.bridge.use(delivery);

  io.use((socket, next) => {
    const req = socket.request as HandshakeRequest;
    const response = {
      setHeader() {},
      getHeader() {
        return undefined;
      },
      writeHead() {},
      end() {},
    };
    options.session(req as never, response as never, (error?: unknown) => {
      if (error) {
        next(error instanceof Error ? error : new Error("UNAUTHENTICATED"));
        return;
      }
      const userId = req.session?.userId;
      const issuedAt = req.session?.issuedAt;
      if (!userId || issuedAt === undefined || isSessionExpired(issuedAt, Date.now())) {
        next(new Error("UNAUTHENTICATED"));
        return;
      }
      void options.users
        .findById(userId)
        .then((user) => {
          if (!user || user.status !== "ACTIVE") {
            next(new Error("UNAUTHENTICATED"));
            return;
          }
          socket.data.userId = user.id;
          next();
        })
        .catch(() => next(new Error("UNAUTHENTICATED")));
    });
  });

  io.on("connection", (socket) => {
    const userId = (): string => socket.data.userId as string;

    socket.on("notification.subscribe", () => {
      void socket.join(`user:${userId()}`);
    });

    socket.on("conversation.join", (payload: unknown, ack?: (result: { ok: boolean }) => void) => {
      const parsed = socketJoinSchema.safeParse(payload);
      if (!parsed.success) {
        ack?.({ ok: false });
        return;
      }
      void options.messaging
        .requireParticipant(userId(), parsed.data.conversationId, socket.id)
        .then(async () => {
          const room = `conversation:${parsed.data.conversationId}`;
          const already = socket.rooms.has(room);
          await socket.join(room);
          if (!already) {
            changeCount(counts, parsed.data.conversationId, userId(), 1);
          }
          ack?.({ ok: true });
        })
        .catch(() => ack?.({ ok: false }));
    });

    socket.on("conversation.typing", (payload: unknown) => {
      const parsed = socketJoinSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      void options.messaging
        .requireParticipant(userId(), parsed.data.conversationId, socket.id)
        .then(() => {
          socket.to(`conversation:${parsed.data.conversationId}`).emit("typing", {
            conversationId: parsed.data.conversationId,
            userId: userId(),
          });
        })
        .catch(() => undefined);
    });

    socket.on("message.send", (payload: unknown, ack?: (result: { ok: boolean }) => void) => {
      const parsed = socketSendSchema.safeParse(payload);
      if (!parsed.success) {
        ack?.({ ok: false });
        return;
      }
      void options.messaging
        .send(userId(), parsed.data.conversationId, { body: parsed.data.body }, socket.id)
        .then(() => ack?.({ ok: true }))
        .catch(() => ack?.({ ok: false }));
    });

    socket.on("disconnecting", () => {
      for (const room of socket.rooms) {
        if (room.startsWith("conversation:")) {
          changeCount(counts, room.slice("conversation:".length), userId(), -1);
        }
      }
    });
  });

  return {
    close: () => io.close(),
  };
}
