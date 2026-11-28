package com.example.order;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface OrderMapper {

    @Select("select o.id, l.sku "
            + "from t_order o "
            + "join t_line l on l.order_id = o.id "
            + "where o.code = #{code}")
    Object listWithLines(String code);

    @Select({
        "select o.id, p.amount",
        "from t_order o",
        "join t_payment p on p.order_no = o.order_no",
        "where o.id = #{id}"
    })
    Object listWithPayment(Long id);

    @Update("update t_order set state = #{state} where id = #{id}")
    int touchState(Long id, String state);

    String MESSAGE = "select * from t_not_a_real_table x join t_also_not y on y.id = x.y_id";

}
