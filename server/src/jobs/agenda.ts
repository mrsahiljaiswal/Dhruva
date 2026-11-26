import Agenda from "agenda";

export function createAgenda(mongoUri: string): Agenda {
  return new Agenda({
    db: { address: mongoUri, collection: "agendaJobs" },
    processEvery: "30 seconds",
  });
}
