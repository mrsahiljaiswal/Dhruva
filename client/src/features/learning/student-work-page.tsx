import { useParams } from "react-router-dom";
import { WorkList } from "./work-list";

export function StudentWorkPage({ own = false }: { own?: boolean }) {
  const params = useParams();
  const studentId = own ? undefined : params.studentId;
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{own ? "Your assignments" : "Student assignments"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Overdue is shown from the due date. It is not stored on the assignment.</p>
      </div>
      <WorkList studentId={studentId} />
    </section>
  );
}
