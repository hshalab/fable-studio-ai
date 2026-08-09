import type { Video } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  exchangeCode as ytExchangeCode,
  fetchMyChannel,
  getAuthUrl as ytGetAuthUrl,
  hasRealYoutubeTokens,
  isYoutubeConfiguredFor,
  uploadVideo,
} from "../youtube";
import type { AccountIdentity, Publisher, PublishResult, ResolvedConnection, StoredTokens } from "./types";

/**
 * YouTube as a Publisher.
 *
 * A thin adapter over the existing service, on purpose — that code is the only
 * publishing path with real mileage on it (resumable upload, quota handling,
 * AI-disclosure, analytics). Rewriting it to fit a new interface would risk the
 * one destination that currently works in order to add two that do not.
 *
 * It still takes a Prisma Channel rather than a ResolvedConnection, so this
 * loads the row. That indirection disappears when the legacy youtubeJson column
 * is retired.
 */
export const youtubePublisher: Publisher = {
  id: "youtube",
  label: "YouTube",
  caps: {
    publicAutoPost: true,
    needsPublicMediaUrl: false,
    maxTitle: 100,
    maxDescription: 5000,
    maxTags: 500,
    maxDurationSec: 60,
    // The documented videos.insert allowance is a separate daily bucket from
    // the general quota; treated as unbounded here and enforced upstream.
    dailyPostQuota: null,
  },

  isConfiguredFor: (userId) => isYoutubeConfiguredFor(userId),

  getAuthUrl: (channelId, userId) => ytGetAuthUrl(channelId, userId),

  async exchangeCode(code, userId): Promise<StoredTokens> {
    const tokens = await ytExchangeCode(code, userId);
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiryMs: tokens.expiryMs,
      scope: tokens.scope,
      connectedAt: new Date().toISOString(),
    };
  },

  async hasRealTokens(connection): Promise<boolean> {
    if (!connection) return false;
    const channel = await prisma.channel.findUnique({ where: { id: connection.channelId } });
    return channel ? hasRealYoutubeTokens(channel) : false;
  },

  async fetchIdentity(connection): Promise<AccountIdentity | null> {
    const channel = await prisma.channel.findUnique({ where: { id: connection.channelId } });
    if (!channel) return null;
    const info = await fetchMyChannel(channel);
    if (!info) return null;
    return {
      externalAccountId: "",
      displayName: info.title ?? channel.name,
      handle: info.handle ?? channel.handle,
      followerCount: info.subscriberCount ?? 0,
    };
  },

  async publish(connection, video: Video): Promise<PublishResult> {
    const channel = await prisma.channel.findUnique({ where: { id: connection.channelId } });
    if (!channel) throw new Error(`Channel ${connection.channelId} disappeared mid-publish`);
    const { youtubeId } = await uploadVideo(channel, video);
    return {
      externalId: youtubeId,
      externalUrl: `https://youtube.com/watch?v=${youtubeId}`,
      state: "published",
    };
  },
};
