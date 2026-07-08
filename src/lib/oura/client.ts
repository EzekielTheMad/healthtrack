// Phase 5: Oura Ring API v2 client
// https://cloud.ouraring.com/v2/docs

export interface OuraSleepDoc {
  id: string;
  day: string;
  bedtime_start: string;
  bedtime_end: string;
  total_sleep_duration: number; // seconds
  rem_sleep_duration: number;
  deep_sleep_duration: number;
  light_sleep_duration: number;
  awake_time: number;
  average_heart_rate: number | null;
  lowest_heart_rate: number | null;
  average_hrv: number | null;
  efficiency: number | null;
}

export interface OuraHRDoc {
  bpm: number;
  source: string;
  timestamp: string;
}

export interface OuraSpO2Doc {
  id: string;
  day: string;
  spo2_percentage: {
    average: number;
  } | null;
}

export interface OuraPersonalInfo {
  age: number;
  weight: number;
  height: number;
  email: string;
}

interface OuraListResponse<T> {
  data: T[];
  next_token: string | null;
}

export class OuraClient {
  private baseUrl = 'https://api.ouraring.com/v2/usercollection';

  constructor(private accessToken: string) {}

  private async request<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Oura API error ${response.status}: ${response.statusText}${body ? ` - ${body}` : ''}`
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * Fetch all pages for a paginated Oura endpoint.
   */
  private async requestPaginated<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<T[]> {
    const all: T[] = [];
    let nextToken: string | null = null;

    do {
      const queryParams = { ...params };
      if (nextToken) {
        queryParams.next_token = nextToken;
      }

      const page = await this.request<OuraListResponse<T>>(path, queryParams);
      all.push(...page.data);
      nextToken = page.next_token;
    } while (nextToken);

    return all;
  }

  /**
   * Fetch sleep documents for a date range (YYYY-MM-DD).
   */
  async getSleepData(startDate: string, endDate: string): Promise<OuraSleepDoc[]> {
    return this.requestPaginated<OuraSleepDoc>('/sleep', {
      start_date: startDate,
      end_date: endDate,
    });
  }

  /**
   * Fetch heart rate samples for a date range.
   */
  async getHeartRate(startDate: string, endDate: string): Promise<OuraHRDoc[]> {
    return this.requestPaginated<OuraHRDoc>('/heartrate', {
      start_datetime: `${startDate}T00:00:00+00:00`,
      end_datetime: `${endDate}T23:59:59+00:00`,
    });
  }

  /**
   * Fetch daily SpO2 readings for a date range.
   * Only available for Gen 3+ rings with active membership.
   */
  async getSpO2(startDate: string, endDate: string): Promise<OuraSpO2Doc[]> {
    return this.requestPaginated<OuraSpO2Doc>('/daily_spo2', {
      start_date: startDate,
      end_date: endDate,
    });
  }

  /**
   * Fetch personal info (age, weight in kg, height in cm).
   */
  async getPersonalInfo(): Promise<{ age: number; weight: number; height: number }> {
    const info = await this.request<OuraPersonalInfo>('/personal_info');
    return {
      age: info.age,
      weight: info.weight,
      height: info.height,
    };
  }
}
