package com.example.order;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;

public class OrderQuery {

    /* Only a wrapper call that can carry a join is read. A QueryWrapper chain is a
       single-table predicate, so it must stay out of the graph: mining it would
       turn `eq("state", 1)` into a table called "state". */
    public QueryWrapper<Order> wrapperOnly() {
        return new QueryWrapper<Order>()
                .eq("state", 1)
                .like("code", "A%")
                .orderByDesc("id");
    }

    public QueryWrapper<Order> withJoin() {
        QueryWrapper<Order> wrapper = new QueryWrapper<>();
        wrapper.apply("select o.id from t_order o join t_line l on l.order_id = o.id");
        return wrapper;
    }

}
