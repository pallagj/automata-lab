import { describe, expect, it } from "vitest";
import { cellName, uniqueName, usedNames, withName } from "./names";

describe("worksheet names", () => {
  it("a cell's name, canonical", () => {
    expect(cellName("Machine:\n  name: M1\n  charset: a")).toBe("M_1");
    expect(cellName("Machine:\n  name: \"M_{even}\"\n  charset: a")).toBe("M_{even}");
    expect(cellName("Machine:\n  charset: a")).toBeNull();
    expect(cellName("Machine:\n  name: EvenA")).toBeNull();
    expect(cellName("D_2 = det(M)")).toBe("D_2");
    expect(cellName("det(M)")).toBeNull();
    expect(cellName("Min = min(M)")).toBeNull();
  });

  it("new names count on in the subscript", () => {
    const used = usedNames([{ source: "M = det(N)" }, { source: "M_2 = det(N)" }, { source: "M_{det} = det(M)" }]);
    expect(uniqueName("A", used)).toBe("A");
    expect(uniqueName("M", used)).toBe("M_3");
    expect(uniqueName("M_2", used)).toBe("M_3");
    expect(uniqueName("M_{det}", used)).toBe("M_{det2}");
  });

  it("naming a cell", () => {
    expect(withName("det(M)", "D")).toBe("D = det(M)");
  });
});
