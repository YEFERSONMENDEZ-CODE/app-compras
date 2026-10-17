import { api } from "./api";

export type HouseholdMember = {
  user_id: string;
  name: string;
  email: string;
  role: "owner" | "member";
};

export type HouseholdInvitation = {
  id: string;
  email?: string;
  household_name?: string;
  invited_by?: string;
  created_at: string;
};

export type Household = {
  id: string;
  name: string;
  role: "owner" | "member";
  members: HouseholdMember[];
  pending_invitations: HouseholdInvitation[];
};

export type HouseholdState = {
  household: Household | null;
  pending_invitations: HouseholdInvitation[];
};

export const getHousehold = () => api<HouseholdState>("/household");
export const createHousehold = (name: string) =>
  api<HouseholdState>("/household", { method: "POST", body: { name } });
export const inviteToHousehold = (email: string) =>
  api<HouseholdInvitation>("/household/invitations", { method: "POST", body: { email } });
export const acceptHouseholdInvitation = (id: string) =>
  api<HouseholdState>(`/household/invitations/${id}/accept`, { method: "POST" });
export const removeHouseholdMember = (id: string) =>
  api<HouseholdState>(`/household/members/${id}`, { method: "DELETE" });
export const leaveHousehold = () =>
  api<HouseholdState>("/household/leave", { method: "POST" });
export const cancelHouseholdInvitation = (id: string) =>
  api<HouseholdState>(`/household/invitations/${id}`, { method: "DELETE" });
