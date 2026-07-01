
import React from "react";

export default function EmployeeModal({
  open,
  employee,
  setEmployee,
  onSave,
  onClose,
}) {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          background: "#fff",
          width: 500,
          borderRadius: 15,
          padding: 25,
        }}
      >
        <h2 style={{ marginTop: 0 }}>بيانات الموظف</h2>

        <input
          placeholder="اسم الموظف"
          value={employee.name || ""}
          onChange={(e) =>
            setEmployee({ ...employee, name: e.target.value })
          }
          style={{ width: "100%", marginBottom: 10 }}
        />

        <input
          placeholder="رقم الجوال"
          value={employee.phone || ""}
          onChange={(e) =>
            setEmployee({ ...employee, phone: e.target.value })
          }
          style={{ width: "100%", marginBottom: 10 }}
        />

        <input
          placeholder="الوظيفة"
          value={employee.job_title || ""}
          onChange={(e) =>
            setEmployee({ ...employee, job_title: e.target.value })
          }
          style={{ width: "100%", marginBottom: 10 }}
        />

        <input
          type="number"
          placeholder="الراتب الأساسي"
          value={employee.salary || ""}
          onChange={(e) =>
            setEmployee({ ...employee, salary: e.target.value })
          }
          style={{ width: "100%", marginBottom: 10 }}
        />

        <textarea
          placeholder="ملاحظات"
          value={employee.notes || ""}
          onChange={(e) =>
            setEmployee({ ...employee, notes: e.target.value })
          }
          style={{
            width: "100%",
            height: 90,
            marginBottom: 15,
          }}
        />

        <label>
          <input
            type="checkbox"
            checked={employee.is_active ?? true}
            onChange={(e) =>
              setEmployee({
                ...employee,
                is_active: e.target.checked,
              })
            }
          />
          نشط
        </label>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 20,
          }}
        >
          <button onClick={onClose}>إلغاء</button>

          <button
            onClick={onSave}
            style={{
              background: "#16a34a",
              color: "#fff",
              padding: "8px 20px",
              border: "none",
              borderRadius: 8,
            }}
          >
            حفظ
          </button>
        </div>
      </div>
    </div>
  );
}
