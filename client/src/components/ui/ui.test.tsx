import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "@/components/states/empty-state";
import { Spinner } from "@/components/states/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function BranchSelect() {
  const [branch, setBranch] = useState("CSE");
  return (
    <Select value={branch} onValueChange={setBranch}>
      <SelectTrigger aria-label="Branch">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="CSE">CSE</SelectItem>
        <SelectItem value="ECE">ECE</SelectItem>
      </SelectContent>
    </Select>
  );
}

function ModalExample() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open modal</Button>
      <Modal open={open} onOpenChange={setOpen} title="Example">
        <p>Modal body</p>
      </Modal>
    </>
  );
}

describe("shared interface components", () => {
  it("renders the basic controls", () => {
    render(
      <div>
        <Button>Save</Button>
        <Input aria-label="Email" defaultValue="ada@example.com" />
        <Badge>Active</Badge>
        <Spinner label="Loading students" />
        <EmptyState title="Nothing here" description="Check back later." />
      </div>,
    );

    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("ada@example.com");
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading students");
    expect(screen.getByRole("heading", { name: "Nothing here" })).toBeInTheDocument();
  });

  it("opens a modal", async () => {
    const user = userEvent.setup();
    render(<ModalExample />);

    await user.click(screen.getByRole("button", { name: "Open modal" }));
    expect(await screen.findByRole("dialog", { name: "Example" })).toHaveTextContent("Modal body");
  });

  it("changes a select value", async () => {
    const user = userEvent.setup();
    render(<BranchSelect />);

    await user.click(screen.getByRole("combobox", { name: "Branch" }));
    await user.click(await screen.findByRole("option", { name: "ECE" }));
    expect(screen.getByRole("combobox", { name: "Branch" })).toHaveTextContent("ECE");
  });
});
