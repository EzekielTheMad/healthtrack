// Oura Ring API v2 client. Date ranges follow endpoint semantics documented by Oura.
export interface OuraSleepDoc {
  id: string; day: string; bedtime_start: string; bedtime_end: string;
  total_sleep_duration: number; time_in_bed?: number; rem_sleep_duration: number;
  deep_sleep_duration: number; light_sleep_duration: number; awake_time: number;
  latency?: number; average_heart_rate: number | null; lowest_heart_rate: number | null;
  average_hrv: number | null; average_breath?: number | null; efficiency: number | null;
  restless_periods?: number | null;
}
export interface OuraHRDoc { bpm: number; source: string; timestamp: string; }
export interface OuraSpO2Doc { id: string; day: string; spo2_percentage: { average: number } | null; breathing_disturbance_index?: number | null; }
export interface OuraDailyDoc { id?: string; day: string; [key: string]: unknown; }
export interface OuraPersonalInfo { age: number; weight: number; height: number; email: string; }
interface OuraListResponse<T> { data: T[]; next_token: string | null; }

export class OuraClient {
  private readonly baseUrl = 'https://api.ouraring.com/v2/usercollection';
  constructor(private readonly accessToken: string) {}

  private async request<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
    const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${this.accessToken}` } });
    if (!response.ok) throw new Error(`Oura API error ${response.status}: ${response.statusText}`);
    return response.json() as Promise<T>;
  }

  private async requestPaginated<T>(path: string, params: Record<string, string>): Promise<T[]> {
    const all: T[] = []; let nextToken: string | null = null;
    do {
      const page: OuraListResponse<T> = await this.request<OuraListResponse<T>>(path, { ...params, ...(nextToken ? { next_token: nextToken } : {}) });
      all.push(...page.data); nextToken = page.next_token;
    } while (nextToken);
    return all;
  }

  async getSleepData(startDate: string, endDate: string): Promise<OuraSleepDoc[]> {
    return this.requestPaginated('/sleep', { start_date: startDate, end_date: endDate });
  }
  async getHeartRate(startDate: string, endDate: string): Promise<OuraHRDoc[]> {
    return this.requestPaginated('/heartrate', { start_datetime: `${startDate}T00:00:00+00:00`, end_datetime: `${endDate}T23:59:59+00:00` });
  }
  async getSpO2(startDate: string, endDate: string): Promise<OuraSpO2Doc[]> {
    return this.requestPaginated('/daily_spo2', { start_date: startDate, end_date: endDate });
  }
  async getDailySleep(startDate: string, endDate: string) { return this.getDaily('/daily_sleep', startDate, endDate); }
  async getDailyReadiness(startDate: string, endDate: string) { return this.getDaily('/daily_readiness', startDate, endDate); }
  async getDailyStress(startDate: string, endDate: string) { return this.getDaily('/daily_stress', startDate, endDate); }
  async getDailyActivity(startDate: string, endDate: string) { return this.getDaily('/daily_activity', startDate, endDate); }
  async getDailyResilience(startDate: string, endDate: string) { return this.getDaily('/daily_resilience', startDate, endDate); }
  private getDaily(path: string, startDate: string, endDate: string) { return this.requestPaginated<OuraDailyDoc>(path, { start_date: startDate, end_date: endDate }); }
  async getPersonalInfo(): Promise<{ age: number; weight: number; height: number }> {
    const info = await this.request<OuraPersonalInfo>('/personal_info'); return { age: info.age, weight: info.weight, height: info.height };
  }
}
