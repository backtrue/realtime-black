import { AppError, type EccalPort } from "./contracts";

async function call<T>(operation: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new AppError("ECCAL_UNAVAILABLE")), 10000);
    })]);
  } finally { clearTimeout(timer); }
}
export function boundedEccal(port: EccalPort): EccalPort {
  return {
    authenticate: credentials => call(() => port.authenticate(credentials)),
    balance: memberId => call(() => port.balance(memberId)),
    reserve: (memberId, operationId) => call(() => port.reserve(memberId, operationId)),
    settle: (memberId, reservationId, events) => call(() => port.settle(memberId, reservationId, events)),
    mcpGrant: memberId => call(() => port.mcpGrant(memberId)),
  };
}
