import { ConnectorConfig, DataConnect, OperationOptions, ExecuteOperationResponse } from 'firebase-admin/data-connect';

export const connectorConfig: ConnectorConfig;

export type TimestampString = string;
export type UUIDString = string;
export type Int64String = string;
export type DateString = string;


export interface AnalyticsEvent_Key {
  id: UUIDString;
  __typename?: 'AnalyticsEvent_Key';
}

export interface CallToAction_Key {
  id: UUIDString;
  __typename?: 'CallToAction_Key';
}

export interface Campaign_Key {
  id: UUIDString;
  __typename?: 'Campaign_Key';
}

export interface CreateAnalyticsEventData {
  analyticsEvent_insert: AnalyticsEvent_Key;
}

export interface CreateAnalyticsEventVariables {
  type: string;
  lpId: UUIDString;
}

export interface CreateCallToActionData {
  callToAction_insert: CallToAction_Key;
}

export interface CreateCallToActionVariables {
  label: string;
  url: string;
  lpId: UUIDString;
}

export interface CreateCampaignData {
  campaign_insert: Campaign_Key;
}

export interface CreateLandingPageData {
  landingPage_insert: LandingPage_Key;
}

export interface CreateLandingPageVariables {
  title: string;
  slug: string;
  campaignId?: UUIDString | null;
}

export interface CreateLeadData {
  lead_insert: Lead_Key;
}

export interface CreateLeadVariables {
  email: string;
  sourcePageId: UUIDString;
}

export interface DeleteAnalyticsEventData {
  analyticsEvent_delete?: AnalyticsEvent_Key | null;
}

export interface DeleteAnalyticsEventVariables {
  id: UUIDString;
}

export interface DeleteCallToActionData {
  callToAction_delete?: CallToAction_Key | null;
}

export interface DeleteCallToActionVariables {
  id: UUIDString;
}

export interface DeleteCampaignData {
  campaign_delete?: Campaign_Key | null;
}

export interface DeleteCampaignVariables {
  id: UUIDString;
}

export interface DeleteLandingPageData {
  landingPage_delete?: LandingPage_Key | null;
}

export interface DeleteLandingPageVariables {
  id: UUIDString;
}

export interface DeleteLeadData {
  lead_delete?: Lead_Key | null;
}

export interface DeleteLeadVariables {
  id: UUIDString;
}

export interface GetAnalyticsEventData {
  analyticsEvent?: {
    eventType: string;
    timestamp: TimestampString;
  };
}

export interface GetAnalyticsEventVariables {
  id: UUIDString;
}

export interface GetCallToActionData {
  callToAction?: {
    label: string;
    targetUrl: string;
  };
}

export interface GetCallToActionVariables {
  id: UUIDString;
}

export interface GetCampaignData {
  campaign?: {
    name: string;
    startDate: DateString;
    budget?: number | null;
  };
}

export interface GetCampaignVariables {
  id: UUIDString;
}

export interface GetLandingPageData {
  landingPage?: {
    title: string;
    slug: string;
    status: string;
  };
}

export interface GetLandingPageVariables {
  id: UUIDString;
}

export interface GetLeadData {
  lead?: {
    email: string;
    firstName?: string | null;
    company?: string | null;
  };
}

export interface GetLeadVariables {
  id: UUIDString;
}

export interface LandingPage_Key {
  id: UUIDString;
  __typename?: 'LandingPage_Key';
}

export interface Lead_Key {
  id: UUIDString;
  __typename?: 'Lead_Key';
}

export interface ListAnalyticsEventsData {
  analyticsEvents: ({
    eventType: string;
    timestamp: TimestampString;
  })[];
}

export interface ListCallToActionsData {
  callToActions: ({
    label: string;
    targetUrl: string;
  })[];
}

export interface ListCampaignsData {
  campaigns: ({
    name: string;
    budget?: number | null;
  })[];
}

export interface ListLandingPagesData {
  landingPages: ({
    title: string;
    slug: string;
    status: string;
  })[];
}

export interface ListLeadsData {
  leads: ({
    email: string;
    firstName?: string | null;
    submittedAt: TimestampString;
  })[];
}

export interface UpdateCallToActionData {
  callToAction_update?: CallToAction_Key | null;
}

export interface UpdateCallToActionVariables {
  id: UUIDString;
  label?: string | null;
}

export interface UpdateCampaignData {
  campaign_update?: Campaign_Key | null;
}

export interface UpdateCampaignVariables {
  id: UUIDString;
  budget?: number | null;
}

export interface UpdateLandingPageData {
  landingPage_update?: LandingPage_Key | null;
}

export interface UpdateLandingPageVariables {
  id: UUIDString;
  status?: string | null;
}

export interface UpdateLeadData {
  lead_update?: Lead_Key | null;
}

export interface UpdateLeadVariables {
  id: UUIDString;
  company?: string | null;
}

/** Generated Node Admin SDK operation action function for the 'CreateCampaign' Mutation. Allow users to execute without passing in DataConnect. */
export function createCampaign(dc: DataConnect, options?: OperationOptions): Promise<ExecuteOperationResponse<CreateCampaignData>>;
/** Generated Node Admin SDK operation action function for the 'CreateCampaign' Mutation. Allow users to pass in custom DataConnect instances. */
export function createCampaign(options?: OperationOptions): Promise<ExecuteOperationResponse<CreateCampaignData>>;

/** Generated Node Admin SDK operation action function for the 'UpdateCampaign' Mutation. Allow users to execute without passing in DataConnect. */
export function updateCampaign(dc: DataConnect, vars: UpdateCampaignVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<UpdateCampaignData>>;
/** Generated Node Admin SDK operation action function for the 'UpdateCampaign' Mutation. Allow users to pass in custom DataConnect instances. */
export function updateCampaign(vars: UpdateCampaignVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<UpdateCampaignData>>;

/** Generated Node Admin SDK operation action function for the 'DeleteCampaign' Mutation. Allow users to execute without passing in DataConnect. */
export function deleteCampaign(dc: DataConnect, vars: DeleteCampaignVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<DeleteCampaignData>>;
/** Generated Node Admin SDK operation action function for the 'DeleteCampaign' Mutation. Allow users to pass in custom DataConnect instances. */
export function deleteCampaign(vars: DeleteCampaignVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<DeleteCampaignData>>;

/** Generated Node Admin SDK operation action function for the 'GetCampaign' Query. Allow users to execute without passing in DataConnect. */
export function getCampaign(dc: DataConnect, vars: GetCampaignVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<GetCampaignData>>;
/** Generated Node Admin SDK operation action function for the 'GetCampaign' Query. Allow users to pass in custom DataConnect instances. */
export function getCampaign(vars: GetCampaignVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<GetCampaignData>>;

/** Generated Node Admin SDK operation action function for the 'ListCampaigns' Query. Allow users to execute without passing in DataConnect. */
export function listCampaigns(dc: DataConnect, options?: OperationOptions): Promise<ExecuteOperationResponse<ListCampaignsData>>;
/** Generated Node Admin SDK operation action function for the 'ListCampaigns' Query. Allow users to pass in custom DataConnect instances. */
export function listCampaigns(options?: OperationOptions): Promise<ExecuteOperationResponse<ListCampaignsData>>;

/** Generated Node Admin SDK operation action function for the 'CreateLandingPage' Mutation. Allow users to execute without passing in DataConnect. */
export function createLandingPage(dc: DataConnect, vars: CreateLandingPageVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<CreateLandingPageData>>;
/** Generated Node Admin SDK operation action function for the 'CreateLandingPage' Mutation. Allow users to pass in custom DataConnect instances. */
export function createLandingPage(vars: CreateLandingPageVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<CreateLandingPageData>>;

/** Generated Node Admin SDK operation action function for the 'UpdateLandingPage' Mutation. Allow users to execute without passing in DataConnect. */
export function updateLandingPage(dc: DataConnect, vars: UpdateLandingPageVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<UpdateLandingPageData>>;
/** Generated Node Admin SDK operation action function for the 'UpdateLandingPage' Mutation. Allow users to pass in custom DataConnect instances. */
export function updateLandingPage(vars: UpdateLandingPageVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<UpdateLandingPageData>>;

/** Generated Node Admin SDK operation action function for the 'DeleteLandingPage' Mutation. Allow users to execute without passing in DataConnect. */
export function deleteLandingPage(dc: DataConnect, vars: DeleteLandingPageVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<DeleteLandingPageData>>;
/** Generated Node Admin SDK operation action function for the 'DeleteLandingPage' Mutation. Allow users to pass in custom DataConnect instances. */
export function deleteLandingPage(vars: DeleteLandingPageVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<DeleteLandingPageData>>;

/** Generated Node Admin SDK operation action function for the 'GetLandingPage' Query. Allow users to execute without passing in DataConnect. */
export function getLandingPage(dc: DataConnect, vars: GetLandingPageVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<GetLandingPageData>>;
/** Generated Node Admin SDK operation action function for the 'GetLandingPage' Query. Allow users to pass in custom DataConnect instances. */
export function getLandingPage(vars: GetLandingPageVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<GetLandingPageData>>;

/** Generated Node Admin SDK operation action function for the 'ListLandingPages' Query. Allow users to execute without passing in DataConnect. */
export function listLandingPages(dc: DataConnect, options?: OperationOptions): Promise<ExecuteOperationResponse<ListLandingPagesData>>;
/** Generated Node Admin SDK operation action function for the 'ListLandingPages' Query. Allow users to pass in custom DataConnect instances. */
export function listLandingPages(options?: OperationOptions): Promise<ExecuteOperationResponse<ListLandingPagesData>>;

/** Generated Node Admin SDK operation action function for the 'CreateLead' Mutation. Allow users to execute without passing in DataConnect. */
export function createLead(dc: DataConnect, vars: CreateLeadVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<CreateLeadData>>;
/** Generated Node Admin SDK operation action function for the 'CreateLead' Mutation. Allow users to pass in custom DataConnect instances. */
export function createLead(vars: CreateLeadVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<CreateLeadData>>;

/** Generated Node Admin SDK operation action function for the 'UpdateLead' Mutation. Allow users to execute without passing in DataConnect. */
export function updateLead(dc: DataConnect, vars: UpdateLeadVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<UpdateLeadData>>;
/** Generated Node Admin SDK operation action function for the 'UpdateLead' Mutation. Allow users to pass in custom DataConnect instances. */
export function updateLead(vars: UpdateLeadVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<UpdateLeadData>>;

/** Generated Node Admin SDK operation action function for the 'DeleteLead' Mutation. Allow users to execute without passing in DataConnect. */
export function deleteLead(dc: DataConnect, vars: DeleteLeadVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<DeleteLeadData>>;
/** Generated Node Admin SDK operation action function for the 'DeleteLead' Mutation. Allow users to pass in custom DataConnect instances. */
export function deleteLead(vars: DeleteLeadVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<DeleteLeadData>>;

/** Generated Node Admin SDK operation action function for the 'GetLead' Query. Allow users to execute without passing in DataConnect. */
export function getLead(dc: DataConnect, vars: GetLeadVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<GetLeadData>>;
/** Generated Node Admin SDK operation action function for the 'GetLead' Query. Allow users to pass in custom DataConnect instances. */
export function getLead(vars: GetLeadVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<GetLeadData>>;

/** Generated Node Admin SDK operation action function for the 'ListLeads' Query. Allow users to execute without passing in DataConnect. */
export function listLeads(dc: DataConnect, options?: OperationOptions): Promise<ExecuteOperationResponse<ListLeadsData>>;
/** Generated Node Admin SDK operation action function for the 'ListLeads' Query. Allow users to pass in custom DataConnect instances. */
export function listLeads(options?: OperationOptions): Promise<ExecuteOperationResponse<ListLeadsData>>;

/** Generated Node Admin SDK operation action function for the 'CreateCallToAction' Mutation. Allow users to execute without passing in DataConnect. */
export function createCallToAction(dc: DataConnect, vars: CreateCallToActionVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<CreateCallToActionData>>;
/** Generated Node Admin SDK operation action function for the 'CreateCallToAction' Mutation. Allow users to pass in custom DataConnect instances. */
export function createCallToAction(vars: CreateCallToActionVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<CreateCallToActionData>>;

/** Generated Node Admin SDK operation action function for the 'UpdateCallToAction' Mutation. Allow users to execute without passing in DataConnect. */
export function updateCallToAction(dc: DataConnect, vars: UpdateCallToActionVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<UpdateCallToActionData>>;
/** Generated Node Admin SDK operation action function for the 'UpdateCallToAction' Mutation. Allow users to pass in custom DataConnect instances. */
export function updateCallToAction(vars: UpdateCallToActionVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<UpdateCallToActionData>>;

/** Generated Node Admin SDK operation action function for the 'DeleteCallToAction' Mutation. Allow users to execute without passing in DataConnect. */
export function deleteCallToAction(dc: DataConnect, vars: DeleteCallToActionVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<DeleteCallToActionData>>;
/** Generated Node Admin SDK operation action function for the 'DeleteCallToAction' Mutation. Allow users to pass in custom DataConnect instances. */
export function deleteCallToAction(vars: DeleteCallToActionVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<DeleteCallToActionData>>;

/** Generated Node Admin SDK operation action function for the 'GetCallToAction' Query. Allow users to execute without passing in DataConnect. */
export function getCallToAction(dc: DataConnect, vars: GetCallToActionVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<GetCallToActionData>>;
/** Generated Node Admin SDK operation action function for the 'GetCallToAction' Query. Allow users to pass in custom DataConnect instances. */
export function getCallToAction(vars: GetCallToActionVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<GetCallToActionData>>;

/** Generated Node Admin SDK operation action function for the 'ListCallToActions' Query. Allow users to execute without passing in DataConnect. */
export function listCallToActions(dc: DataConnect, options?: OperationOptions): Promise<ExecuteOperationResponse<ListCallToActionsData>>;
/** Generated Node Admin SDK operation action function for the 'ListCallToActions' Query. Allow users to pass in custom DataConnect instances. */
export function listCallToActions(options?: OperationOptions): Promise<ExecuteOperationResponse<ListCallToActionsData>>;

/** Generated Node Admin SDK operation action function for the 'CreateAnalyticsEvent' Mutation. Allow users to execute without passing in DataConnect. */
export function createAnalyticsEvent(dc: DataConnect, vars: CreateAnalyticsEventVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<CreateAnalyticsEventData>>;
/** Generated Node Admin SDK operation action function for the 'CreateAnalyticsEvent' Mutation. Allow users to pass in custom DataConnect instances. */
export function createAnalyticsEvent(vars: CreateAnalyticsEventVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<CreateAnalyticsEventData>>;

/** Generated Node Admin SDK operation action function for the 'DeleteAnalyticsEvent' Mutation. Allow users to execute without passing in DataConnect. */
export function deleteAnalyticsEvent(dc: DataConnect, vars: DeleteAnalyticsEventVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<DeleteAnalyticsEventData>>;
/** Generated Node Admin SDK operation action function for the 'DeleteAnalyticsEvent' Mutation. Allow users to pass in custom DataConnect instances. */
export function deleteAnalyticsEvent(vars: DeleteAnalyticsEventVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<DeleteAnalyticsEventData>>;

/** Generated Node Admin SDK operation action function for the 'GetAnalyticsEvent' Query. Allow users to execute without passing in DataConnect. */
export function getAnalyticsEvent(dc: DataConnect, vars: GetAnalyticsEventVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<GetAnalyticsEventData>>;
/** Generated Node Admin SDK operation action function for the 'GetAnalyticsEvent' Query. Allow users to pass in custom DataConnect instances. */
export function getAnalyticsEvent(vars: GetAnalyticsEventVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<GetAnalyticsEventData>>;

/** Generated Node Admin SDK operation action function for the 'ListAnalyticsEvents' Query. Allow users to execute without passing in DataConnect. */
export function listAnalyticsEvents(dc: DataConnect, options?: OperationOptions): Promise<ExecuteOperationResponse<ListAnalyticsEventsData>>;
/** Generated Node Admin SDK operation action function for the 'ListAnalyticsEvents' Query. Allow users to pass in custom DataConnect instances. */
export function listAnalyticsEvents(options?: OperationOptions): Promise<ExecuteOperationResponse<ListAnalyticsEventsData>>;

