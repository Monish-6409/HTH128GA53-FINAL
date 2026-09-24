export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agent_outputs: {
        Row: {
          agent: string
          conflicts: Json
          created_at: string
          findings: Json
          id: string
          model: string | null
          priority: string | null
          provider_name: string | null
          provider_slot: number | null
          reasoning_summary: string | null
          recommendations: Json
          request_id: string | null
          resource_requirements: Json
        }
        Insert: {
          agent: string
          conflicts?: Json
          created_at?: string
          findings?: Json
          id?: string
          model?: string | null
          priority?: string | null
          provider_name?: string | null
          provider_slot?: number | null
          reasoning_summary?: string | null
          recommendations?: Json
          request_id?: string | null
          resource_requirements?: Json
        }
        Update: {
          agent?: string
          conflicts?: Json
          created_at?: string
          findings?: Json
          id?: string
          model?: string | null
          priority?: string | null
          provider_name?: string | null
          provider_slot?: number | null
          reasoning_summary?: string | null
          recommendations?: Json
          request_id?: string | null
          resource_requirements?: Json
        }
        Relationships: [
          {
            foreignKeyName: "agent_outputs_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "emergency_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      emergency_requests: {
        Row: {
          contact: string | null
          created_at: string
          emergency_type: string
          id: string
          location_text: string
          medical_notes: string | null
          people_count: number
          ref_code: string
          severity: string
          status: string
          zone: string | null
        }
        Insert: {
          contact?: string | null
          created_at?: string
          emergency_type: string
          id?: string
          location_text: string
          medical_notes?: string | null
          people_count?: number
          ref_code: string
          severity: string
          status?: string
          zone?: string | null
        }
        Update: {
          contact?: string | null
          created_at?: string
          emergency_type?: string
          id?: string
          location_text?: string
          medical_notes?: string | null
          people_count?: number
          ref_code?: string
          severity?: string
          status?: string
          zone?: string | null
        }
        Relationships: []
      }
      officers: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          status: string
          user_id: string | null
          username: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          user_id?: string | null
          username: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          user_id?: string | null
          username?: string
        }
        Relationships: []
      }
      resources: {
        Row: {
          available: number
          category: string
          created_at: string
          id: string
          name: string
          quantity: number
          status: string
          zone: string | null
        }
        Insert: {
          available?: number
          category: string
          created_at?: string
          id?: string
          name: string
          quantity?: number
          status?: string
          zone?: string | null
        }
        Update: {
          available?: number
          category?: string
          created_at?: string
          id?: string
          name?: string
          quantity?: number
          status?: string
          zone?: string | null
        }
        Relationships: []
      }
      response_plans: {
        Row: {
          actions: Json
          created_at: string
          id: string
          priority: string | null
          request_id: string | null
          resource_allocation: Json
          summary: string
        }
        Insert: {
          actions?: Json
          created_at?: string
          id?: string
          priority?: string | null
          request_id?: string | null
          resource_allocation?: Json
          summary: string
        }
        Update: {
          actions?: Json
          created_at?: string
          id?: string
          priority?: string | null
          request_id?: string | null
          resource_allocation?: Json
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "response_plans_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "emergency_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "coordinator" | "officer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["coordinator", "officer"],
    },
  },
} as const
