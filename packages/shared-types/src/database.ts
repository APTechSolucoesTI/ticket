export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  apticket: {
    Tables: {
      canned_responses: {
        Row: {
          body: string;
          created_at: string;
          created_by: string | null;
          id: string;
          tenant_id: string;
          title: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          tenant_id: string;
          title: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          tenant_id?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "canned_responses_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      companies: {
        Row: {
          address_city: string | null;
          address_complement: string | null;
          address_neighborhood: string | null;
          address_number: string | null;
          address_state: string | null;
          address_street: string | null;
          address_zip: string | null;
          cnpj: string | null;
          created_at: string;
          fantasy_name: string | null;
          id: string;
          is_vip: boolean;
          name: string;
          notes: string | null;
          phone: string | null;
          segment: string | null;
          tenant_id: string;
          updated_at: string;
          website: string | null;
        };
        Insert: {
          address_city?: string | null;
          address_complement?: string | null;
          address_neighborhood?: string | null;
          address_number?: string | null;
          address_state?: string | null;
          address_street?: string | null;
          address_zip?: string | null;
          cnpj?: string | null;
          created_at?: string;
          fantasy_name?: string | null;
          id?: string;
          is_vip?: boolean;
          name: string;
          notes?: string | null;
          phone?: string | null;
          segment?: string | null;
          tenant_id: string;
          updated_at?: string;
          website?: string | null;
        };
        Update: {
          address_city?: string | null;
          address_complement?: string | null;
          address_neighborhood?: string | null;
          address_number?: string | null;
          address_state?: string | null;
          address_street?: string | null;
          address_zip?: string | null;
          cnpj?: string | null;
          created_at?: string;
          fantasy_name?: string | null;
          id?: string;
          is_vip?: boolean;
          name?: string;
          notes?: string | null;
          phone?: string | null;
          segment?: string | null;
          tenant_id?: string;
          updated_at?: string;
          website?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "companies_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      contas_receber: {
        Row: {
          aprovado_em: string;
          aprovado_por: string | null;
          cliente_nome: string;
          company_id: string;
          competencia: string;
          contrato_id: string;
          created_at: string;
          deleted_at: string | null;
          descricao: string;
          documento_referencia: string;
          id: string;
          medicao_id: string;
          observacoes: string | null;
          status_cobranca: Database["apticket"]["Enums"]["status_cobranca_avulsa"];
          tenant_id: string;
          updated_at: string;
          valor_aberto: number;
          valor_original: number;
          vencimento_em: string;
        };
        Insert: {
          aprovado_em: string;
          aprovado_por?: string | null;
          cliente_nome: string;
          company_id: string;
          competencia: string;
          contrato_id: string;
          created_at?: string;
          deleted_at?: string | null;
          descricao: string;
          documento_referencia: string;
          id?: string;
          medicao_id: string;
          observacoes?: string | null;
          status_cobranca?: Database["apticket"]["Enums"]["status_cobranca_avulsa"];
          tenant_id: string;
          updated_at?: string;
          valor_aberto: number;
          valor_original: number;
          vencimento_em: string;
        };
        Update: {
          aprovado_em?: string;
          aprovado_por?: string | null;
          cliente_nome?: string;
          company_id?: string;
          competencia?: string;
          contrato_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          descricao?: string;
          documento_referencia?: string;
          id?: string;
          medicao_id?: string;
          observacoes?: string | null;
          status_cobranca?: Database["apticket"]["Enums"]["status_cobranca_avulsa"];
          tenant_id?: string;
          updated_at?: string;
          valor_aberto?: number;
          valor_original?: number;
          vencimento_em?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contas_receber_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contas_receber_contrato_id_fkey";
            columns: ["contrato_id"];
            isOneToOne: false;
            referencedRelation: "contracts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contas_receber_medicao_id_fkey";
            columns: ["medicao_id"];
            isOneToOne: true;
            referencedRelation: "medicoes_contrato";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contas_receber_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      contacts: {
        Row: {
          can_open_tickets: boolean;
          company_id: string | null;
          created_at: string;
          email: string | null;
          id: string;
          is_active: boolean;
          job_title: string | null;
          name: string;
          notes: string | null;
          phone: string | null;
          receives_csat: boolean;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          can_open_tickets?: boolean;
          company_id?: string | null;
          created_at?: string;
          email?: string | null;
          id?: string;
          is_active?: boolean;
          job_title?: string | null;
          name: string;
          notes?: string | null;
          phone?: string | null;
          receives_csat?: boolean;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          can_open_tickets?: boolean;
          company_id?: string | null;
          created_at?: string;
          email?: string | null;
          id?: string;
          is_active?: boolean;
          job_title?: string | null;
          name?: string;
          notes?: string | null;
          phone?: string | null;
          receives_csat?: boolean;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contacts_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      contract_equipments: {
        Row: {
          contract_id: string;
          created_at: string;
          equipment_id: string;
          id: string;
          tenant_id: string;
        };
        Insert: {
          contract_id: string;
          created_at?: string;
          equipment_id: string;
          id?: string;
          tenant_id: string;
        };
        Update: {
          contract_id?: string;
          created_at?: string;
          equipment_id?: string;
          id?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contract_equipments_contract_id_fkey";
            columns: ["contract_id"];
            isOneToOne: false;
            referencedRelation: "contracts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contract_equipments_equipment_id_fkey";
            columns: ["equipment_id"];
            isOneToOne: false;
            referencedRelation: "equipments";
            referencedColumns: ["id"];
          },
        ];
      };
      contract_types: {
        Row: {
          billing_model: string;
          created_at: string;
          default_hours_monthly: number;
          default_monthly_value: number;
          description: string | null;
          equipment_max: number | null;
          equipment_min: number | null;
          equipment_tiers: Json;
          id: string;
          includes_lab: boolean;
          includes_onsite: boolean;
          includes_remote: boolean;
          name: string;
          price_per_equipment: number | null;
          service_items: Json;
          tenant_id: string;
        };
        Insert: {
          billing_model?: string;
          created_at?: string;
          default_hours_monthly?: number;
          default_monthly_value?: number;
          description?: string | null;
          equipment_max?: number | null;
          equipment_min?: number | null;
          equipment_tiers?: Json;
          id?: string;
          includes_lab?: boolean;
          includes_onsite?: boolean;
          includes_remote?: boolean;
          name: string;
          price_per_equipment?: number | null;
          service_items?: Json;
          tenant_id: string;
        };
        Update: {
          billing_model?: string;
          created_at?: string;
          default_hours_monthly?: number;
          default_monthly_value?: number;
          description?: string | null;
          equipment_max?: number | null;
          equipment_min?: number | null;
          equipment_tiers?: Json;
          id?: string;
          includes_lab?: boolean;
          includes_onsite?: boolean;
          includes_remote?: boolean;
          name?: string;
          price_per_equipment?: number | null;
          service_items?: Json;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contract_types_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      contracts: {
        Row: {
          auto_renew: boolean;
          billing_model: string;
          company_id: string;
          contract_type_id: string | null;
          created_at: string;
          dia_vencimento: number;
          description: string | null;
          emite_boleto: boolean;
          emite_nf: boolean;
          ends_at: string;
          equipment_tiers: Json;
          extra_hour_price: number;
          hours_monthly_quota: number;
          id: string;
          includes_lab: boolean;
          includes_onsite: boolean;
          includes_remote: boolean;
          monthly_value: number;
          notes: string | null;
          numero_contrato: string;
          service_items: Json;
          sla_policy_id: string | null;
          starts_at: string;
          status: Database["apticket"]["Enums"]["contract_status"];
          tenant_id: string;
          tipo_medicao: Database["apticket"]["Enums"]["tipo_medicao_contrato"];
          tipo_vencimento: Database["apticket"]["Enums"]["tipo_vencimento_contrato"];
          updated_at: string;
        };
        Insert: {
          auto_renew?: boolean;
          billing_model?: string;
          company_id: string;
          contract_type_id?: string | null;
          created_at?: string;
          dia_vencimento?: number;
          description?: string | null;
          emite_boleto?: boolean;
          emite_nf?: boolean;
          ends_at: string;
          equipment_tiers?: Json;
          extra_hour_price?: number;
          hours_monthly_quota?: number;
          id?: string;
          includes_lab?: boolean;
          includes_onsite?: boolean;
          includes_remote?: boolean;
          monthly_value?: number;
          notes?: string | null;
          numero_contrato?: string;
          service_items?: Json;
          sla_policy_id?: string | null;
          starts_at: string;
          status?: Database["apticket"]["Enums"]["contract_status"];
          tenant_id: string;
          tipo_medicao?: Database["apticket"]["Enums"]["tipo_medicao_contrato"];
          tipo_vencimento?: Database["apticket"]["Enums"]["tipo_vencimento_contrato"];
          updated_at?: string;
        };
        Update: {
          auto_renew?: boolean;
          billing_model?: string;
          company_id?: string;
          contract_type_id?: string | null;
          created_at?: string;
          dia_vencimento?: number;
          description?: string | null;
          emite_boleto?: boolean;
          emite_nf?: boolean;
          ends_at?: string;
          equipment_tiers?: Json;
          extra_hour_price?: number;
          hours_monthly_quota?: number;
          id?: string;
          includes_lab?: boolean;
          includes_onsite?: boolean;
          includes_remote?: boolean;
          monthly_value?: number;
          notes?: string | null;
          numero_contrato?: string;
          service_items?: Json;
          sla_policy_id?: string | null;
          starts_at?: string;
          status?: Database["apticket"]["Enums"]["contract_status"];
          tenant_id?: string;
          tipo_medicao?: Database["apticket"]["Enums"]["tipo_medicao_contrato"];
          tipo_vencimento?: Database["apticket"]["Enums"]["tipo_vencimento_contrato"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contracts_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contracts_contract_type_id_fkey";
            columns: ["contract_type_id"];
            isOneToOne: false;
            referencedRelation: "contract_types";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contracts_sla_policy_id_fkey";
            columns: ["sla_policy_id"];
            isOneToOne: false;
            referencedRelation: "sla_policies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contracts_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      csat_responses: {
        Row: {
          comment: string | null;
          contact_id: string | null;
          created_at: string;
          id: string;
          rating: number | null;
          responded_at: string | null;
          sent_at: string | null;
          tenant_id: string;
          ticket_id: string;
          token: string | null;
        };
        Insert: {
          comment?: string | null;
          contact_id?: string | null;
          created_at?: string;
          id?: string;
          rating?: number | null;
          responded_at?: string | null;
          sent_at?: string | null;
          tenant_id: string;
          ticket_id: string;
          token?: string | null;
        };
        Update: {
          comment?: string | null;
          contact_id?: string | null;
          created_at?: string;
          id?: string;
          rating?: number | null;
          responded_at?: string | null;
          sent_at?: string | null;
          tenant_id?: string;
          ticket_id?: string;
          token?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "csat_responses_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "csat_responses_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "csat_responses_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      departments: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          name: string;
          tenant_id: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          name: string;
          tenant_id: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          name?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "departments_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      email_pending_messages: {
        Row: {
          attachments: Json;
          contact_id: string | null;
          content: string;
          created_at: string;
          from_email: string;
          from_name: string | null;
          id: string;
          message_id: string | null;
          resolved_at: string | null;
          subject: string | null;
          tenant_id: string;
        };
        Insert: {
          attachments?: Json;
          contact_id?: string | null;
          content: string;
          created_at?: string;
          from_email: string;
          from_name?: string | null;
          id?: string;
          message_id?: string | null;
          resolved_at?: string | null;
          subject?: string | null;
          tenant_id: string;
        };
        Update: {
          attachments?: Json;
          contact_id?: string | null;
          content?: string;
          created_at?: string;
          from_email?: string;
          from_name?: string | null;
          id?: string;
          message_id?: string | null;
          resolved_at?: string | null;
          subject?: string | null;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "email_pending_messages_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "email_pending_messages_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      equipments: {
        Row: {
          asset_tag: string | null;
          brand: string | null;
          company_id: string;
          contact_id: string | null;
          created_at: string;
          id: string;
          location: string | null;
          memory: string | null;
          model: string | null;
          name: string;
          notes: string | null;
          office_key: string | null;
          operating_system: string | null;
          os_key: string | null;
          processor: string | null;
          purchase_date: string | null;
          serial_number: string | null;
          status: string;
          storage: string | null;
          tenant_id: string;
          type: string | null;
          updated_at: string;
          warranty_until: string | null;
        };
        Insert: {
          asset_tag?: string | null;
          brand?: string | null;
          company_id: string;
          contact_id?: string | null;
          created_at?: string;
          id?: string;
          location?: string | null;
          memory?: string | null;
          model?: string | null;
          name: string;
          notes?: string | null;
          office_key?: string | null;
          operating_system?: string | null;
          os_key?: string | null;
          processor?: string | null;
          purchase_date?: string | null;
          serial_number?: string | null;
          status?: string;
          storage?: string | null;
          tenant_id: string;
          type?: string | null;
          updated_at?: string;
          warranty_until?: string | null;
        };
        Update: {
          asset_tag?: string | null;
          brand?: string | null;
          company_id?: string;
          contact_id?: string | null;
          created_at?: string;
          id?: string;
          location?: string | null;
          memory?: string | null;
          model?: string | null;
          name?: string;
          notes?: string | null;
          office_key?: string | null;
          operating_system?: string | null;
          os_key?: string | null;
          processor?: string | null;
          purchase_date?: string | null;
          serial_number?: string | null;
          status?: string;
          storage?: string | null;
          tenant_id?: string;
          type?: string | null;
          updated_at?: string;
          warranty_until?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "equipments_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "equipments_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "equipments_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      kb_articles: {
        Row: {
          attachments: Json;
          body: string;
          category_id: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          is_public: boolean;
          published_at: string | null;
          slug: string;
          status: Database["apticket"]["Enums"]["kb_status"];
          tenant_id: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          attachments?: Json;
          body?: string;
          category_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_public?: boolean;
          published_at?: string | null;
          slug: string;
          status?: Database["apticket"]["Enums"]["kb_status"];
          tenant_id: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          attachments?: Json;
          body?: string;
          category_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_public?: boolean;
          published_at?: string | null;
          slug?: string;
          status?: Database["apticket"]["Enums"]["kb_status"];
          tenant_id?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "kb_articles_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "kb_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "kb_articles_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      kb_categories: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          parent_id: string | null;
          slug: string;
          tenant_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          parent_id?: string | null;
          slug: string;
          tenant_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          parent_id?: string | null;
          slug?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "kb_categories_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "kb_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "kb_categories_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      feriados: {
        Row: {
          abrangencia: string;
          created_at: string;
          data: string;
          id: string;
          nome: string;
          tenant_id: string | null;
        };
        Insert: {
          abrangencia?: string;
          created_at?: string;
          data: string;
          id?: string;
          nome: string;
          tenant_id?: string | null;
        };
        Update: {
          abrangencia?: string;
          created_at?: string;
          data?: string;
          id?: string;
          nome?: string;
          tenant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "feriados_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      medicao_itens: {
        Row: {
          created_at: string;
          descricao: string;
          id: string;
          medicao_id: string;
          quantidade: number;
          referencia: string | null;
          referencia_id: string | null;
          tenant_id: string;
          tipo_item: Database["apticket"]["Enums"]["tipo_item_medicao"];
          valor_total: number;
          valor_unitario: number;
        };
        Insert: {
          created_at?: string;
          descricao: string;
          id?: string;
          medicao_id: string;
          quantidade?: number;
          referencia?: string | null;
          referencia_id?: string | null;
          tenant_id: string;
          tipo_item: Database["apticket"]["Enums"]["tipo_item_medicao"];
          valor_total: number;
          valor_unitario: number;
        };
        Update: {
          created_at?: string;
          descricao?: string;
          id?: string;
          medicao_id?: string;
          quantidade?: number;
          referencia?: string | null;
          referencia_id?: string | null;
          tenant_id?: string;
          tipo_item?: Database["apticket"]["Enums"]["tipo_item_medicao"];
          valor_total?: number;
          valor_unitario?: number;
        };
        Relationships: [
          {
            foreignKeyName: "medicao_itens_medicao_id_fkey";
            columns: ["medicao_id"];
            isOneToOne: false;
            referencedRelation: "medicoes_contrato";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "medicao_itens_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      medicoes_contrato: {
        Row: {
          aprovada_em: string | null;
          aprovada_por: string | null;
          aprovada_por_nome: string | null;
          cancelada_em: string | null;
          cancelada_por: string | null;
          cancelada_por_nome: string | null;
          cliente_nome: string;
          competencia: string;
          contrato_id: string;
          created_at: string;
          data_medicao: string;
          data_vencimento: string;
          deleted_at: string | null;
          emite_boleto: boolean;
          emite_nf: boolean;
          id: string;
          justificativa_cancelamento: string | null;
          modelo_cobranca: string;
          numero_contrato: string;
          report_token: string;
          status: Database["apticket"]["Enums"]["status_medicao_contrato"];
          tenant_id: string;
          tipo_contrato_nome: string | null;
          valor_total: number;
        };
        Insert: {
          aprovada_em?: string | null;
          aprovada_por?: string | null;
          aprovada_por_nome?: string | null;
          cancelada_em?: string | null;
          cancelada_por?: string | null;
          cancelada_por_nome?: string | null;
          cliente_nome: string;
          competencia: string;
          contrato_id: string;
          created_at?: string;
          data_medicao?: string;
          data_vencimento: string;
          deleted_at?: string | null;
          emite_boleto: boolean;
          emite_nf: boolean;
          id?: string;
          justificativa_cancelamento?: string | null;
          modelo_cobranca: string;
          numero_contrato: string;
          report_token?: string;
          status?: Database["apticket"]["Enums"]["status_medicao_contrato"];
          tenant_id: string;
          tipo_contrato_nome?: string | null;
          valor_total: number;
        };
        Update: {
          aprovada_em?: string | null;
          aprovada_por?: string | null;
          aprovada_por_nome?: string | null;
          cancelada_em?: string | null;
          cancelada_por?: string | null;
          cancelada_por_nome?: string | null;
          cliente_nome?: string;
          competencia?: string;
          contrato_id?: string;
          created_at?: string;
          data_medicao?: string;
          data_vencimento?: string;
          deleted_at?: string | null;
          emite_boleto?: boolean;
          emite_nf?: boolean;
          id?: string;
          justificativa_cancelamento?: string | null;
          modelo_cobranca?: string;
          numero_contrato?: string;
          report_token?: string;
          status?: Database["apticket"]["Enums"]["status_medicao_contrato"];
          tenant_id?: string;
          tipo_contrato_nome?: string | null;
          valor_total?: number;
        };
        Relationships: [
          {
            foreignKeyName: "medicoes_contrato_contrato_id_fkey";
            columns: ["contrato_id"];
            isOneToOne: false;
            referencedRelation: "contracts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "medicoes_contrato_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          attachments: Json;
          author_contact_id: string | null;
          author_id: string | null;
          author_type: Database["apticket"]["Enums"]["message_author_type"];
          channel: Database["apticket"]["Enums"]["ticket_channel"] | null;
          content: string;
          created_at: string;
          delivery_attempts: number;
          delivery_error: string | null;
          delivery_status: string | null;
          external_id: string | null;
          id: string;
          is_internal: boolean;
          tenant_id: string;
          ticket_id: string;
        };
        Insert: {
          attachments?: Json;
          author_contact_id?: string | null;
          author_id?: string | null;
          author_type: Database["apticket"]["Enums"]["message_author_type"];
          channel?: Database["apticket"]["Enums"]["ticket_channel"] | null;
          content: string;
          created_at?: string;
          delivery_attempts?: number;
          delivery_error?: string | null;
          delivery_status?: string | null;
          external_id?: string | null;
          id?: string;
          is_internal?: boolean;
          tenant_id: string;
          ticket_id: string;
        };
        Update: {
          attachments?: Json;
          author_contact_id?: string | null;
          author_id?: string | null;
          author_type?: Database["apticket"]["Enums"]["message_author_type"];
          channel?: Database["apticket"]["Enums"]["ticket_channel"] | null;
          content?: string;
          created_at?: string;
          delivery_attempts?: number;
          delivery_error?: string | null;
          delivery_status?: string | null;
          external_id?: string | null;
          id?: string;
          is_internal?: boolean;
          tenant_id?: string;
          ticket_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_author_contact_id_fkey";
            columns: ["author_contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      pause_reasons: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          name: string;
          tenant_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name: string;
          tenant_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pause_reasons_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      portal_otp_codes: {
        Row: {
          attempts: number;
          code_hash: string;
          consumed_at: string | null;
          contact_id: string;
          created_at: string;
          delivered_at: string | null;
          delivery_error: string | null;
          delivery_status: string;
          email: string;
          expires_at: string;
          id: string;
          tenant_id: string;
        };
        Insert: {
          attempts?: number;
          code_hash: string;
          consumed_at?: string | null;
          contact_id: string;
          created_at?: string;
          delivered_at?: string | null;
          delivery_error?: string | null;
          delivery_status?: string;
          email: string;
          expires_at: string;
          id?: string;
          tenant_id: string;
        };
        Update: {
          attempts?: number;
          code_hash?: string;
          consumed_at?: string | null;
          contact_id?: string;
          created_at?: string;
          delivered_at?: string | null;
          delivery_error?: string | null;
          delivery_status?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "portal_otp_codes_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "portal_otp_codes_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          email: string;
          id: string;
          is_active: boolean;
          name: string;
          password_hash: string | null;
          tenant_id: string;
          tickets_auto_refresh_enabled: boolean;
          tickets_auto_refresh_seconds: number;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          email: string;
          id: string;
          is_active?: boolean;
          name: string;
          password_hash?: string | null;
          tenant_id: string;
          tickets_auto_refresh_enabled?: boolean;
          tickets_auto_refresh_seconds?: number;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          email?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          password_hash?: string | null;
          tenant_id?: string;
          tickets_auto_refresh_enabled?: boolean;
          tickets_auto_refresh_seconds?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      invites: {
        Row: {
          accepted_at: string | null;
          created_at: string;
          expires_at: string;
          id: string;
          profile_id: string;
          token_hash: string;
        };
        Insert: {
          accepted_at?: string | null;
          created_at?: string;
          expires_at: string;
          id?: string;
          profile_id: string;
          token_hash: string;
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string;
          expires_at?: string;
          id?: string;
          profile_id?: string;
          token_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invites_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      password_resets: {
        Row: {
          accepted_at: string | null;
          created_at: string;
          expires_at: string;
          id: string;
          profile_id: string;
          token_hash: string;
        };
        Insert: {
          accepted_at?: string | null;
          created_at?: string;
          expires_at: string;
          id?: string;
          profile_id: string;
          token_hash: string;
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string;
          expires_at?: string;
          id?: string;
          profile_id?: string;
          token_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: "password_resets_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      provided_services: {
        Row: {
          code: string;
          created_at: string;
          description: string;
          family_id: string;
          id: string;
          includes_lab: boolean;
          includes_onsite: boolean;
          includes_remote: boolean;
          is_active: boolean;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          description: string;
          family_id: string;
          id?: string;
          includes_lab?: boolean;
          includes_onsite?: boolean;
          includes_remote?: boolean;
          is_active?: boolean;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          description?: string;
          family_id?: string;
          id?: string;
          includes_lab?: boolean;
          includes_onsite?: boolean;
          includes_remote?: boolean;
          is_active?: boolean;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "provided_services_family_id_fkey";
            columns: ["family_id"];
            isOneToOne: false;
            referencedRelation: "service_families";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "provided_services_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      service_families: {
        Row: {
          code: string;
          created_at: string;
          description: string;
          id: string;
          is_active: boolean;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          description: string;
          id?: string;
          is_active?: boolean;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          description?: string;
          id?: string;
          is_active?: boolean;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_families_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      sla_policies: {
        Row: {
          created_at: string;
          first_response_minutes: number;
          id: string;
          name: string;
          priority: Database["apticket"]["Enums"]["ticket_priority"] | null;
          resolution_minutes: number;
          tenant_id: string;
        };
        Insert: {
          created_at?: string;
          first_response_minutes?: number;
          id?: string;
          name: string;
          priority?: Database["apticket"]["Enums"]["ticket_priority"] | null;
          resolution_minutes?: number;
          tenant_id: string;
        };
        Update: {
          created_at?: string;
          first_response_minutes?: number;
          id?: string;
          name?: string;
          priority?: Database["apticket"]["Enums"]["ticket_priority"] | null;
          resolution_minutes?: number;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sla_policies_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      stickers: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
          storage_path: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name: string;
          storage_path: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
          storage_path?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tenants: {
        Row: {
          address_city: string | null;
          address_complement: string | null;
          address_country: string | null;
          address_district: string | null;
          address_number: string | null;
          address_state: string | null;
          address_street: string | null;
          business_days: string[] | null;
          business_hours_end: string | null;
          business_hours_start: string | null;
          cnpj: string | null;
          created_at: string;
          email: string | null;
          email_enabled: boolean;
          email_imap_host: string | null;
          email_imap_password: string | null;
          email_imap_port: number;
          email_imap_secure: boolean;
          email_imap_user: string | null;
          email_inbox_address: string | null;
          email_last_polled_at: string | null;
          email_poll_interval_minutes: number;
          email_smtp_host: string | null;
          email_smtp_port: number;
          email_smtp_secure: boolean;
          id: string;
          legal_name: string | null;
          logo_url: string | null;
          municipal_registration: string | null;
          name: string;
          notes: string | null;
          phone: string | null;
          plan: string;
          primary_color: string | null;
          slug: string;
          state_registration: string | null;
          support_email: string | null;
          support_phone: string | null;
          timezone: string | null;
          trade_name: string | null;
          updated_at: string;
          website: string | null;
          whatsapp: string | null;
          whatsapp_connected_number: string | null;
          whatsapp_enabled: boolean;
          whatsapp_uazapi_base_url: string | null;
          whatsapp_uazapi_instance: string | null;
          whatsapp_uazapi_token: string | null;
          whatsapp_webhook_secret: string | null;
          zip_code: string | null;
        };
        Insert: {
          address_city?: string | null;
          address_complement?: string | null;
          address_country?: string | null;
          address_district?: string | null;
          address_number?: string | null;
          address_state?: string | null;
          address_street?: string | null;
          business_days?: string[] | null;
          business_hours_end?: string | null;
          business_hours_start?: string | null;
          cnpj?: string | null;
          created_at?: string;
          email?: string | null;
          email_enabled?: boolean;
          email_imap_host?: string | null;
          email_imap_password?: string | null;
          email_imap_port?: number;
          email_imap_secure?: boolean;
          email_imap_user?: string | null;
          email_inbox_address?: string | null;
          email_last_polled_at?: string | null;
          email_poll_interval_minutes?: number;
          email_smtp_host?: string | null;
          email_smtp_port?: number;
          email_smtp_secure?: boolean;
          id?: string;
          legal_name?: string | null;
          logo_url?: string | null;
          municipal_registration?: string | null;
          name: string;
          notes?: string | null;
          phone?: string | null;
          plan?: string;
          primary_color?: string | null;
          slug: string;
          state_registration?: string | null;
          support_email?: string | null;
          support_phone?: string | null;
          timezone?: string | null;
          trade_name?: string | null;
          updated_at?: string;
          website?: string | null;
          whatsapp?: string | null;
          whatsapp_connected_number?: string | null;
          whatsapp_enabled?: boolean;
          whatsapp_uazapi_base_url?: string | null;
          whatsapp_uazapi_instance?: string | null;
          whatsapp_uazapi_token?: string | null;
          whatsapp_webhook_secret?: string | null;
          zip_code?: string | null;
        };
        Update: {
          address_city?: string | null;
          address_complement?: string | null;
          address_country?: string | null;
          address_district?: string | null;
          address_number?: string | null;
          address_state?: string | null;
          address_street?: string | null;
          business_days?: string[] | null;
          business_hours_end?: string | null;
          business_hours_start?: string | null;
          cnpj?: string | null;
          created_at?: string;
          email?: string | null;
          email_enabled?: boolean;
          email_imap_host?: string | null;
          email_imap_password?: string | null;
          email_imap_port?: number;
          email_imap_secure?: boolean;
          email_imap_user?: string | null;
          email_inbox_address?: string | null;
          email_last_polled_at?: string | null;
          email_poll_interval_minutes?: number;
          email_smtp_host?: string | null;
          email_smtp_port?: number;
          email_smtp_secure?: boolean;
          id?: string;
          legal_name?: string | null;
          logo_url?: string | null;
          municipal_registration?: string | null;
          name?: string;
          notes?: string | null;
          phone?: string | null;
          plan?: string;
          primary_color?: string | null;
          slug?: string;
          state_registration?: string | null;
          support_email?: string | null;
          support_phone?: string | null;
          timezone?: string | null;
          trade_name?: string | null;
          updated_at?: string;
          website?: string | null;
          whatsapp?: string | null;
          whatsapp_connected_number?: string | null;
          whatsapp_enabled?: boolean;
          whatsapp_uazapi_base_url?: string | null;
          whatsapp_uazapi_instance?: string | null;
          whatsapp_uazapi_token?: string | null;
          whatsapp_webhook_secret?: string | null;
          zip_code?: string | null;
        };
        Relationships: [];
      };
      ticket_closing_reports: {
        Row: {
          generated_at: string;
          generated_by: string | null;
          id: string;
          tenant_id: string;
          ticket_id: string;
          token: string;
        };
        Insert: {
          generated_at?: string;
          generated_by?: string | null;
          id?: string;
          tenant_id: string;
          ticket_id: string;
          token: string;
        };
        Update: {
          generated_at?: string;
          generated_by?: string | null;
          id?: string;
          tenant_id?: string;
          ticket_id?: string;
          token?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ticket_closing_reports_generated_by_fkey";
            columns: ["generated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ticket_closing_reports_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ticket_closing_reports_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: true;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      ticket_equipments: {
        Row: {
          created_at: string;
          equipment_id: string;
          tenant_id: string;
          ticket_id: string;
        };
        Insert: {
          created_at?: string;
          equipment_id: string;
          tenant_id: string;
          ticket_id: string;
        };
        Update: {
          created_at?: string;
          equipment_id?: string;
          tenant_id?: string;
          ticket_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ticket_equipments_equipment_id_fkey";
            columns: ["equipment_id"];
            isOneToOne: false;
            referencedRelation: "equipments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ticket_equipments_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      tabela_precos_avulso: {
        Row: {
          ativa: boolean;
          created_at: string;
          criado_por: string | null;
          deleted_at: string | null;
          id: string;
          limite_valor_fixo_minutos: number;
          nome: string;
          tenant_id: string;
          updated_at: string;
          valor_fixo: number;
          valor_hora_tecnica: number;
          vigente_ate: string | null;
          vigente_desde: string;
        };
        Insert: {
          ativa?: boolean;
          created_at?: string;
          criado_por?: string | null;
          deleted_at?: string | null;
          id?: string;
          limite_valor_fixo_minutos?: number;
          nome?: string;
          tenant_id: string;
          updated_at?: string;
          valor_fixo?: number;
          valor_hora_tecnica?: number;
          vigente_ate?: string | null;
          vigente_desde?: string;
        };
        Update: {
          ativa?: boolean;
          created_at?: string;
          criado_por?: string | null;
          deleted_at?: string | null;
          id?: string;
          limite_valor_fixo_minutos?: number;
          nome?: string;
          tenant_id?: string;
          updated_at?: string;
          valor_fixo?: number;
          valor_hora_tecnica?: number;
          vigente_ate?: string | null;
          vigente_desde?: string;
        };
        Relationships: [];
      };
      tickets_cobranca_avulsa: {
        Row: {
          atualizado_por: string | null;
          created_at: string;
          criado_por: string | null;
          deleted_at: string | null;
          id: string;
          justificativa_ajuste: string | null;
          limite_valor_fixo_minutos: number;
          minutos_apurados: number;
          observacoes: string | null;
          revisado_em: string | null;
          revisado_por: string | null;
          status_cobranca: Database["apticket"]["Enums"]["status_cobranca_avulsa"];
          tabela_preco_id: string | null;
          tenant_id: string;
          ticket_id: string;
          updated_at: string;
          valor_ajustado_manualmente: boolean;
          valor_base: number;
          valor_final: number;
          valor_fixo_snapshot: number;
          valor_hora_snapshot: number;
          vencimento_em: string | null;
        };
        Insert: {
          atualizado_por?: string | null;
          created_at?: string;
          criado_por?: string | null;
          deleted_at?: string | null;
          id?: string;
          justificativa_ajuste?: string | null;
          limite_valor_fixo_minutos?: number;
          minutos_apurados?: number;
          observacoes?: string | null;
          revisado_em?: string | null;
          revisado_por?: string | null;
          status_cobranca?: Database["apticket"]["Enums"]["status_cobranca_avulsa"];
          tabela_preco_id?: string | null;
          tenant_id: string;
          ticket_id: string;
          updated_at?: string;
          valor_ajustado_manualmente?: boolean;
          valor_base?: number;
          valor_final?: number;
          valor_fixo_snapshot?: number;
          valor_hora_snapshot?: number;
          vencimento_em?: string | null;
        };
        Update: {
          atualizado_por?: string | null;
          created_at?: string;
          criado_por?: string | null;
          deleted_at?: string | null;
          id?: string;
          justificativa_ajuste?: string | null;
          limite_valor_fixo_minutos?: number;
          minutos_apurados?: number;
          observacoes?: string | null;
          revisado_em?: string | null;
          revisado_por?: string | null;
          status_cobranca?: Database["apticket"]["Enums"]["status_cobranca_avulsa"];
          tabela_preco_id?: string | null;
          tenant_id?: string;
          ticket_id?: string;
          updated_at?: string;
          valor_ajustado_manualmente?: boolean;
          valor_base?: number;
          valor_final?: number;
          valor_fixo_snapshot?: number;
          valor_hora_snapshot?: number;
          vencimento_em?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tickets_cobranca_avulsa_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: true;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      tickets_cobranca_avulsa_audit: {
        Row: {
          actor_id: string | null;
          cobranca_id: string;
          created_at: string;
          id: string;
          tenant_id: string;
          valores_anteriores: Json;
          valores_novos: Json;
        };
        Insert: {
          actor_id?: string | null;
          cobranca_id: string;
          created_at?: string;
          id?: string;
          tenant_id: string;
          valores_anteriores: Json;
          valores_novos: Json;
        };
        Update: {
          actor_id?: string | null;
          cobranca_id?: string;
          created_at?: string;
          id?: string;
          tenant_id?: string;
          valores_anteriores?: Json;
          valores_novos?: Json;
        };
        Relationships: [];
      };
      ticket_services_performed: {
        Row: {
          complement: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          provided_service_id: string;
          tenant_id: string;
          ticket_id: string;
        };
        Insert: {
          complement?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          provided_service_id: string;
          tenant_id: string;
          ticket_id: string;
        };
        Update: {
          complement?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          provided_service_id?: string;
          tenant_id?: string;
          ticket_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ticket_services_performed_provided_service_id_fkey";
            columns: ["provided_service_id"];
            isOneToOne: false;
            referencedRelation: "provided_services";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ticket_services_performed_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ticket_services_performed_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      ticket_pauses: {
        Row: {
          complement: string | null;
          created_at: string;
          ended_at: string | null;
          id: string;
          paused_by: string;
          reason_id: string | null;
          reason_snapshot: string;
          resume_source: string | null;
          resumed_by: string | null;
          started_at: string;
          tenant_id: string;
          ticket_id: string;
        };
        Insert: {
          complement?: string | null;
          created_at?: string;
          ended_at?: string | null;
          id?: string;
          paused_by: string;
          reason_id?: string | null;
          reason_snapshot: string;
          resume_source?: string | null;
          resumed_by?: string | null;
          started_at?: string;
          tenant_id: string;
          ticket_id: string;
        };
        Update: {
          complement?: string | null;
          created_at?: string;
          ended_at?: string | null;
          id?: string;
          paused_by?: string;
          reason_id?: string | null;
          reason_snapshot?: string;
          resume_source?: string | null;
          resumed_by?: string | null;
          started_at?: string;
          tenant_id?: string;
          ticket_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ticket_pauses_reason_id_fkey";
            columns: ["reason_id"];
            isOneToOne: false;
            referencedRelation: "pause_reasons";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ticket_pauses_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ticket_pauses_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      tickets: {
        Row: {
          assigned_to: string | null;
          channel: Database["apticket"]["Enums"]["ticket_channel"];
          closed_at: string | null;
          company_id: string | null;
          contact_id: string | null;
          contract_id: string | null;
          created_at: string;
          department_id: string | null;
          equipment_id: string | null;
          first_responded_at: string | null;
          id: string;
          motivo_avulso: Database["apticket"]["Enums"]["motivo_avulso"] | null;
          number: number;
          pending_type: string | null;
          priority: Database["apticket"]["Enums"]["ticket_priority"];
          resolution_diagnosis: string | null;
          resolution_summary: string | null;
          resolved_at: string | null;
          sla_breached: boolean;
          sla_first_response_due_at: string | null;
          sla_policy_id: string | null;
          sla_paused_at: string | null;
          sla_resolution_due_at: string | null;
          status: Database["apticket"]["Enums"]["ticket_status"];
          subject: string;
          tenant_id: string;
          tipo_atendimento: Database["apticket"]["Enums"]["tipo_atendimento"];
          total_sla_paused_seconds: number;
          updated_at: string;
        };
        Insert: {
          assigned_to?: string | null;
          channel?: Database["apticket"]["Enums"]["ticket_channel"];
          closed_at?: string | null;
          company_id?: string | null;
          contact_id?: string | null;
          contract_id?: string | null;
          created_at?: string;
          department_id?: string | null;
          equipment_id?: string | null;
          first_responded_at?: string | null;
          id?: string;
          motivo_avulso?: Database["apticket"]["Enums"]["motivo_avulso"] | null;
          number?: number;
          pending_type?: string | null;
          priority?: Database["apticket"]["Enums"]["ticket_priority"];
          resolution_diagnosis?: string | null;
          resolution_summary?: string | null;
          resolved_at?: string | null;
          sla_breached?: boolean;
          sla_first_response_due_at?: string | null;
          sla_policy_id?: string | null;
          sla_paused_at?: string | null;
          sla_resolution_due_at?: string | null;
          status?: Database["apticket"]["Enums"]["ticket_status"];
          subject: string;
          tenant_id: string;
          tipo_atendimento?: Database["apticket"]["Enums"]["tipo_atendimento"];
          total_sla_paused_seconds?: number;
          updated_at?: string;
        };
        Update: {
          assigned_to?: string | null;
          channel?: Database["apticket"]["Enums"]["ticket_channel"];
          closed_at?: string | null;
          company_id?: string | null;
          contact_id?: string | null;
          contract_id?: string | null;
          created_at?: string;
          department_id?: string | null;
          equipment_id?: string | null;
          first_responded_at?: string | null;
          id?: string;
          motivo_avulso?: Database["apticket"]["Enums"]["motivo_avulso"] | null;
          number?: number;
          pending_type?: string | null;
          priority?: Database["apticket"]["Enums"]["ticket_priority"];
          resolution_diagnosis?: string | null;
          resolution_summary?: string | null;
          resolved_at?: string | null;
          sla_breached?: boolean;
          sla_first_response_due_at?: string | null;
          sla_policy_id?: string | null;
          sla_paused_at?: string | null;
          sla_resolution_due_at?: string | null;
          status?: Database["apticket"]["Enums"]["ticket_status"];
          subject?: string;
          tenant_id?: string;
          tipo_atendimento?: Database["apticket"]["Enums"]["tipo_atendimento"];
          total_sla_paused_seconds?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tickets_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tickets_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tickets_contract_id_fkey";
            columns: ["contract_id"];
            isOneToOne: false;
            referencedRelation: "contracts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tickets_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "departments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tickets_equipment_id_fkey";
            columns: ["equipment_id"];
            isOneToOne: false;
            referencedRelation: "equipments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tickets_sla_policy_id_fkey";
            columns: ["sla_policy_id"];
            isOneToOne: false;
            referencedRelation: "sla_policies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tickets_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      time_entries: {
        Row: {
          agent_id: string;
          created_at: string;
          description: string | null;
          ended_at: string | null;
          id: string;
          minutes: number;
          started_at: string | null;
          tenant_id: string;
          ticket_id: string;
        };
        Insert: {
          agent_id: string;
          created_at?: string;
          description?: string | null;
          ended_at?: string | null;
          id?: string;
          minutes: number;
          started_at?: string | null;
          tenant_id: string;
          ticket_id: string;
        };
        Update: {
          agent_id?: string;
          created_at?: string;
          description?: string | null;
          ended_at?: string | null;
          id?: string;
          minutes?: number;
          started_at?: string | null;
          tenant_id?: string;
          ticket_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "time_entries_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "time_entries_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role_id: string;
          tenant_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role_id: string;
          tenant_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role_id?: string;
          tenant_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_roles_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_roles_role_id_fkey";
            columns: ["role_id"];
            isOneToOne: false;
            referencedRelation: "roles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_roles_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      roles: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          is_system: boolean;
          name: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          is_system?: boolean;
          name: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          is_system?: boolean;
          name?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "roles_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      permissions: {
        Row: {
          action: string;
          created_at: string;
          description: string | null;
          id: string;
          module: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          module: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          module?: string;
        };
        Relationships: [];
      };
      role_permissions: {
        Row: {
          created_at: string;
          id: string;
          permission_id: string;
          role_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          permission_id: string;
          role_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          permission_id?: string;
          role_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "role_permissions_role_id_fkey";
            columns: ["role_id"];
            isOneToOne: false;
            referencedRelation: "roles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "role_permissions_permission_id_fkey";
            columns: ["permission_id"];
            isOneToOne: false;
            referencedRelation: "permissions";
            referencedColumns: ["id"];
          },
        ];
      };
      user_permissions: {
        Row: {
          created_at: string;
          created_by: string | null;
          granted: boolean;
          id: string;
          permission_id: string;
          tenant_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          granted: boolean;
          id?: string;
          permission_id: string;
          tenant_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          granted?: boolean;
          id?: string;
          permission_id?: string;
          tenant_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_permissions_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_permissions_permission_id_fkey";
            columns: ["permission_id"];
            isOneToOne: false;
            referencedRelation: "permissions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_permissions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      permission_audit_log: {
        Row: {
          action: string;
          actor_id: string | null;
          created_at: string;
          detail: Json | null;
          id: string;
          target_id: string;
          target_type: string;
          tenant_id: string;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          created_at?: string;
          detail?: Json | null;
          id?: string;
          target_id: string;
          target_type: string;
          tenant_id: string;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          created_at?: string;
          detail?: Json | null;
          id?: string;
          target_id?: string;
          target_type?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "permission_audit_log_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      whatsapp_pending_messages: {
        Row: {
          attachments: Json;
          contact_id: string | null;
          content: string;
          created_at: string;
          external_id: string | null;
          id: string;
          payload: Json | null;
          phone: string;
          resolved_at: string | null;
          tenant_id: string;
        };
        Insert: {
          attachments?: Json;
          contact_id?: string | null;
          content: string;
          created_at?: string;
          external_id?: string | null;
          id?: string;
          payload?: Json | null;
          phone: string;
          resolved_at?: string | null;
          tenant_id: string;
        };
        Update: {
          attachments?: Json;
          contact_id?: string | null;
          content?: string;
          created_at?: string;
          external_id?: string | null;
          id?: string;
          payload?: Json | null;
          phone?: string;
          resolved_at?: string | null;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_pending_messages_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_pending_messages_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      aprovar_medicao_contrato: {
        Args: { p_medicao_id: string };
        Returns: Json;
      };
      atualizar_cobrancas_vencidas: { Args: never; Returns: number };
      atualizar_status_medicao_contrato: {
        Args: {
          p_medicao_id: string;
          p_status: Database["apticket"]["Enums"]["status_medicao_contrato"];
        };
        Returns: Database["apticket"]["Tables"]["medicoes_contrato"]["Row"];
      };
      calcular_vencimento_medicao: {
        Args: {
          p_competencia: string;
          p_dia_vencimento: number;
          p_tenant_id: string;
          p_tipo_vencimento: Database["apticket"]["Enums"]["tipo_vencimento_contrato"];
        };
        Returns: string;
      };
      cancelar_medicao_contrato_confirmada: {
        Args: {
          p_actor_id: string;
          p_justificativa: string;
          p_medicao_id: string;
          p_tenant_id: string;
        };
        Returns: Database["apticket"]["Tables"]["medicoes_contrato"]["Row"];
      };
      current_tenant_id: { Args: never; Returns: string };
      get_closing_report_by_token: {
        Args: { _token: string };
        Returns: Json;
      };
      get_contract_measurement_report_by_token: {
        Args: { _token: string };
        Returns: Json;
      };
      get_csat_by_token: {
        Args: { _token: string };
        Returns: {
          id: string;
          rating: number;
          responded_at: string;
        }[];
      };
      get_effective_permissions: {
        Args: { _user_id: string };
        Returns: {
          action: string;
          effective: boolean;
          granted_by_role: boolean;
          module: string;
          override: boolean | null;
        }[];
      };
      gerar_medicoes_contrato: {
        Args: {
          p_competencia?: string;
          p_contrato_id?: string | null;
          p_forcar?: boolean;
        };
        Returns: Json;
      };
      has_permission: {
        Args: { _action: string; _module: string; _user_id: string };
        Returns: boolean;
      };
      prever_atendimento_avulso: {
        Args: { _company_id: string; _equipment_ids?: string[] };
        Returns: Json;
      };
      pause_ticket: {
        Args: {
          _complement: string;
          _reason_id: string;
          _ticket_id: string;
          _timer_started_at: string;
        };
        Returns: string;
      };
      resume_ticket: {
        Args: { _ticket_id: string };
        Returns: undefined;
      };
      submit_csat: {
        Args: { _comment: string; _rating: number; _token: string };
        Returns: undefined;
      };
    };
    Enums: {
      contract_status: "active" | "suspended" | "cancelled" | "expired";
      kb_status: "draft" | "published";
      message_author_type: "agent" | "contact" | "system";
      motivo_avulso: "cliente_sem_contrato" | "equipamento_sem_contrato";
      status_cobranca_avulsa: "a_faturar" | "faturado" | "vencido" | "recebido" | "cancelado";
      status_medicao_contrato: "gerada" | "aprovada" | "faturada" | "cancelada";
      ticket_channel: "email" | "whatsapp" | "chat" | "manual" | "portal";
      ticket_priority: "low" | "medium" | "high" | "urgent";
      ticket_status: "new" | "in_progress" | "pending" | "resolved" | "closed";
      tipo_atendimento: "contratual" | "avulso";
      tipo_item_medicao: "equipamento" | "servico" | "pacote_horas";
      tipo_medicao_contrato: "mensal" | "trimestral" | "semestral" | "anual" | "unica";
      tipo_vencimento_contrato: "fixo" | "util";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "apticket">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  apticket: {
    Enums: {
      contract_status: ["active", "suspended", "cancelled", "expired"],
      kb_status: ["draft", "published"],
      message_author_type: ["agent", "contact", "system"],
      motivo_avulso: ["cliente_sem_contrato", "equipamento_sem_contrato"],
      status_cobranca_avulsa: ["a_faturar", "faturado", "vencido", "recebido", "cancelado"],
      ticket_channel: ["email", "whatsapp", "chat", "manual", "portal"],
      ticket_priority: ["low", "medium", "high", "urgent"],
      ticket_status: ["new", "in_progress", "pending", "resolved", "closed"],
      tipo_atendimento: ["contratual", "avulso"],
    },
  },
} as const;
