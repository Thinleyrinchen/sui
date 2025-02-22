// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { useRpcClient } from '@mysten/core';
import { ArrowRight12 } from '@mysten/icons';
import { type JsonRpcProvider } from '@mysten/sui.js';
import { type QueryStatus, useQuery } from '@tanstack/react-query';
import cl from 'clsx';
import { useCallback, useMemo, useState } from 'react';
import toast from 'react-hot-toast';

import TabFooter from '../../components/tabs/TabFooter';
import Pagination from '../pagination/Pagination';
import {
    genTableDataFromTxData,
    getDataOnTxDigests,
    type TxnData,
} from './TxCardUtils';

import styles from './RecentTxCard.module.css';

import { CheckpointsTable } from '~/pages/checkpoints/CheckpointsTable';
import { Banner } from '~/ui/Banner';
import { Link } from '~/ui/Link';
import { PlaceholderTable } from '~/ui/PlaceholderTable';
import { PlayPause } from '~/ui/PlayPause';
import { TableCard } from '~/ui/TableCard';
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from '~/ui/Tabs';
import { useSearchParamsMerged } from '~/ui/utils/LinkWithQuery';

const NUMBER_OF_TX_PER_PAGE = 20;
const DEFAULT_PAGINATION_TYPE = 'more button';

// We refresh transactions at checkpoint boundaries (currently ~10s).
const TRANSACTION_POLL_TIME_SECONDS = 10;
const TRANSACTION_POLL_TIME = TRANSACTION_POLL_TIME_SECONDS * 1000;

const AUTO_REFRESH_ID = 'auto-refresh';

export type PaginationType = 'more button' | 'pagination' | 'none';

function generateStartEndRange(
    txCount: number,
    txNum: number,
    pageNum?: number
): { startGatewayTxSeqNumber: number; endGatewayTxSeqNumber: number } {
    // Pagination pageNum from query params - default to 0; No negative values
    const txPaged = pageNum && pageNum > 0 ? pageNum - 1 : 0;
    const endGatewayTxSeqNumber = txCount - txNum * txPaged;
    const startGatewayTxSeqNumber = Math.max(endGatewayTxSeqNumber - txNum, 0);
    return {
        startGatewayTxSeqNumber,
        endGatewayTxSeqNumber,
    };
}

// TODO: Optimize this method to use fewer API calls. Move the total tx count to this component.
async function getRecentTransactions(
    rpc: JsonRpcProvider,
    totalTx: number,
    txNum: number,
    pageNum?: number
): Promise<TxnData[]> {
    // Get the latest transactions
    // Instead of getRecentTransactions, use getTransactionCount
    // then use getTransactionDigestsInRangeDeprecated using the totalTx as the start totalTx sequence number - txNum as the end sequence number
    // Get the total number of transactions, then use as the start and end values for the getTransactionDigestsInRangeDeprecated
    const { endGatewayTxSeqNumber, startGatewayTxSeqNumber } =
        generateStartEndRange(totalTx, txNum, pageNum);

    // TODO: Add error page
    // If paged tx value is less than 0, out of range
    if (endGatewayTxSeqNumber < 0) {
        throw new Error('Invalid transaction number');
    }
    // TODO: migrate this to `getTransactions`
    const transactionDigests = await rpc.getTransactionDigestsInRangeDeprecated(
        startGatewayTxSeqNumber,
        endGatewayTxSeqNumber
    );

    // result returned by getTransactionDigestsInRangeDeprecated is in ascending order
    const transactionData = await getDataOnTxDigests(
        rpc,
        [...transactionDigests].reverse()
    );

    // TODO: Don't force the type here:
    return transactionData as TxnData[];
}

type Props = {
    paginationtype?: PaginationType;
    txPerPage?: number;
};

// TODO: Remove this when we refactor pagiantion:
export const statusToLoadState: Record<QueryStatus, string> = {
    error: 'fail',
    loading: 'pending',
    success: 'loaded',
};

export function LatestTxCard({
    paginationtype = DEFAULT_PAGINATION_TYPE,
    txPerPage: initialTxPerPage,
}: Props) {
    const [paused, setPaused] = useState(false);
    const [txPerPage, setTxPerPage] = useState(
        initialTxPerPage || NUMBER_OF_TX_PER_PAGE
    );

    const rpc = useRpcClient();
    const [searchParams, setSearchParams] = useSearchParamsMerged();

    const [pageIndex, setPageIndex] = useState(
        parseInt(searchParams.get('p') || '1', 10) || 1
    );

    const handlePageChange = useCallback(
        (newPage: number) => {
            setPageIndex(newPage);
            setSearchParams({
                p: newPage.toString(),
            });
        },
        [setSearchParams]
    );

    const countQuery = useQuery(
        ['transactions', 'count'],
        () => rpc.getTotalTransactionNumber(),
        {
            refetchInterval: paused ? false : TRANSACTION_POLL_TIME,
        }
    );

    const transactionQuery = useQuery(
        ['transactions', { total: countQuery.data, txPerPage, pageIndex }],
        async () => {
            const { data: count } = countQuery;

            if (!count) {
                throw new Error('No transactions found');
            }

            // If pageIndex is greater than maxTxPage, set to maxTxPage
            const maxTxPage = Math.ceil(count / txPerPage);
            const pg = pageIndex > maxTxPage ? maxTxPage : pageIndex;

            return getRecentTransactions(rpc, count, txPerPage, pg);
        },
        {
            enabled: countQuery.isFetched,
            keepPreviousData: true,
        }
    );

    const recentTx = useMemo(
        () =>
            transactionQuery.data
                ? genTableDataFromTxData(transactionQuery.data)
                : null,
        [transactionQuery.data]
    );

    const stats = {
        count: countQuery?.data || 0,
        stats_text: 'Total Transactions',
        loadState: statusToLoadState[countQuery.status],
    };

    const handlePauseChange = () => {
        // If we were paused, immedietly refetch:
        if (paused) {
            countQuery.refetch();
            toast.success(
                `Auto-refreshing on - every ${TRANSACTION_POLL_TIME_SECONDS} seconds`,
                { id: AUTO_REFRESH_ID }
            );
        } else {
            toast.success('Auto-refresh paused', { id: AUTO_REFRESH_ID });
        }

        setPaused((paused) => !paused);
    };

    const PaginationWithStatsOrStatsWithLink =
        paginationtype === 'pagination' ? (
            <Pagination
                totalItems={countQuery?.data || 0}
                itemsPerPage={txPerPage}
                updateItemsPerPage={setTxPerPage}
                onPagiChangeFn={handlePageChange}
                currentPage={pageIndex}
                stats={stats}
            />
        ) : (
            <div className="mt-3">
                <TabFooter stats={stats}>
                    <div className="w-full">
                        <Link to="/transactions">
                            <div className="flex items-center gap-2">
                                More Transactions{' '}
                                <ArrowRight12 fill="currentColor" />
                            </div>
                        </Link>
                    </div>
                </TabFooter>
            </div>
        );

    if (countQuery.isError) {
        return (
            <Banner variant="error" fullWidth>
                No transactions found.
            </Banner>
        );
    }

    if (transactionQuery.isError) {
        return (
            <Banner variant="error" fullWidth>
                There was an issue getting the latest transactions.
            </Banner>
        );
    }

    return (
        <div className={cl(styles.txlatestresults, styles[paginationtype])}>
            <TabGroup size="lg">
                <div className="relative flex items-center">
                    <TabList>
                        <Tab>Transactions</Tab>
                        <Tab>Checkpoints</Tab>
                    </TabList>

                    <div className="absolute inset-y-0 right-0 text-2xl">
                        <PlayPause
                            paused={paused}
                            onChange={handlePauseChange}
                        />
                    </div>
                </div>
                <TabPanels>
                    <TabPanel>
                        {recentTx ? (
                            <TableCard
                                refetching={transactionQuery.isPreviousData}
                                data={recentTx.data}
                                columns={recentTx.columns}
                            />
                        ) : (
                            <PlaceholderTable
                                rowCount={txPerPage}
                                rowHeight="16px"
                                colHeadings={[
                                    'Transaction ID',
                                    'Sender',
                                    'Amount',
                                    'Gas',
                                    'Time',
                                ]}
                                colWidths={[
                                    '100px',
                                    '120px',
                                    '204px',
                                    '90px',
                                    '38px',
                                ]}
                            />
                        )}
                        {paginationtype !== 'none' &&
                            PaginationWithStatsOrStatsWithLink}
                    </TabPanel>
                    <TabPanel>
                        <CheckpointsTable
                            initialItemsPerPage={NUMBER_OF_TX_PER_PAGE}
                            refetchInterval={TRANSACTION_POLL_TIME}
                            shouldRefetch={!paused}
                            paginationType={paginationtype}
                        />
                    </TabPanel>
                </TabPanels>
            </TabGroup>
        </div>
    );
}
