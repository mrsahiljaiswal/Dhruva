export type Delivery = {
  listeners(conversationId: string): string[];
  messageNew(conversationId: string): void;
  messageRead(conversationId: string, userId: string, messageId: string): void;
  typing(conversationId: string, userId: string): void;
  notificationNew(userId: string): void;
};

export const noopDelivery: Delivery = {
  listeners: () => [],
  messageNew: () => {},
  messageRead: () => {},
  typing: () => {},
  notificationNew: () => {},
};

export type DeliveryBridge = Delivery & { use(next: Delivery): void };

export function createDeliveryBridge(): DeliveryBridge {
  let current: Delivery = noopDelivery;
  return {
    use(next) {
      current = next;
    },
    listeners: (conversationId) => current.listeners(conversationId),
    messageNew: (conversationId) => current.messageNew(conversationId),
    messageRead: (conversationId, userId, messageId) => current.messageRead(conversationId, userId, messageId),
    typing: (conversationId, userId) => current.typing(conversationId, userId),
    notificationNew: (userId) => current.notificationNew(userId),
  };
}
